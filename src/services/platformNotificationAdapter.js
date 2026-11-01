import { supabase } from '../lib/supabase'

let androidNotificationSetup

export function getNotificationPlatform() {
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) return 'ANDROID'
  return 'WEB'
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
  const deviceId = localStorage.getItem('booksaloon-device-id') || crypto.randomUUID()
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
    return await androidNotificationSetup
  } catch (error) {
    androidNotificationSetup = undefined
    throw error
  }
}

async function setupAndroidNotifications() {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let permission = await PushNotifications.checkPermissions()
  if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions()
  if (permission.receive !== 'granted') return { supported: true, granted: false }
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
