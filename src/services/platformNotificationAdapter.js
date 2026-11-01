import { supabase } from '../lib/supabase'

let androidNotificationSetup

export function getNotificationPlatform() {
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) return 'ANDROID'
  } catch (error) {
    console.error('Unable to detect notification platform:', error)
  }
  return 'WEB'
}

export async function requestAndroidNotificationPermission() {
  if (getNotificationPlatform() !== 'ANDROID') return { supported: false }
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let permission = await PushNotifications.checkPermissions()
  if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions()
  return { supported: true, granted: permission.receive === 'granted' }
}

export async function publishQueueNotification({ title, body, bookingId, progress, max = 100 }) {
  if (getNotificationPlatform() === 'ANDROID') {
    const plugin = window.Capacitor?.Plugins?.QueueNotification
    if (!plugin) return { platform: 'ANDROID', supported: false, reason: 'Queue notification plugin is not available' }
    await plugin.update({
      title,
      body,
      bookingId,
      progress: Math.round(Math.max(0, Math.min(max, progress)) / max * 100),
    })
    return { platform: 'ANDROID', supported: true }
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { platform: 'WEB', supported: false, reason: 'Notification permission is unavailable' }
  }
  return {
    platform: 'WEB',
    supported: true,
    notification: new Notification(title, {
      body,
      tag: bookingId ? `booksaloon-${bookingId}` : 'booksaloon-queue',
      data: { bookingId, progress, max, url: bookingId ? `/customer/queue/${bookingId}` : '/customer/bookings' },
    }),
  }
}

export async function registerAndroidDevice({ token, userAgent }) {
  if (!token) throw new Error('FCM token is required.')
  const deviceId = localStorage.getItem('booksaloon-device-id')
    || (globalThis.crypto?.randomUUID?.() || `android-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  localStorage.setItem('booksaloon-device-id', deviceId)
  const { error } = await supabase.rpc('register_device_push_subscription', {
    p_device_id: deviceId,
    p_platform: 'ANDROID',
    p_endpoint: token,
    p_permission_status: 'GRANTED',
    p_user_agent: userAgent || navigator.userAgent,
  })
  if (error) throw new Error(error.message)
}

export async function initializeAndroidNotifications() {
  if (getNotificationPlatform() !== 'ANDROID') return { supported: false }
  if (androidNotificationSetup) return androidNotificationSetup
  androidNotificationSetup = setupAndroidNotifications()
  try {
    const result = await androidNotificationSetup
    if (!result.granted) androidNotificationSetup = undefined
    return result
  } catch (error) {
    androidNotificationSetup = undefined
    throw error
  }
}

async function setupAndroidNotifications() {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const permission = await requestAndroidNotificationPermission()
  if (!permission.granted) return permission
  const registerToken = async (token) => {
    await registerAndroidDevice({ token })
  }
  await PushNotifications.addListener('registration', ({ value }) => {
    registerToken(value).catch((error) => console.error('Unable to register Android device:', error))
  })
  const registrationPromise = new Promise((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('Timed out waiting for FCM registration.'))
      }
    }, 15000)
    PushNotifications.addListener('registration', (token) => {
      if (!settled) {
        settled = true
        window.clearTimeout(timeout)
        resolve(token.value)
      }
    })
    PushNotifications.addListener('registrationError', (error) => {
      if (!settled) {
        settled = true
        window.clearTimeout(timeout)
        reject(new Error(error.error || 'FCM registration failed.'))
      }
    })
  })
  await PushNotifications.register()
  const token = await registrationPromise
  await registerToken(token)
  return { supported: true, granted: true }
}
