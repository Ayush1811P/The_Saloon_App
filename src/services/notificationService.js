import { supabase } from '../lib/supabase'

const DEVICE_KEY = 'booksaloon-device-id'

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export async function requestWebNotifications() {
  if (!('Notification' in window)) return { supported: false, granted: false }
  if (Notification.permission === 'denied') return { supported: true, granted: false }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  return { supported: true, granted: permission === 'granted' }
}

export async function registerWebDevice(_userId) {
  const result = await requestWebNotifications()
  if (!result.granted) return result
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ...result, pushSupported: false }
  }
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!publicKey) throw new Error('VITE_VAPID_PUBLIC_KEY is not configured.')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const { error } = await supabase.rpc('register_device_push_subscription', {
    p_device_id: getDeviceId(),
    p_platform: 'WEB',
    p_endpoint: subscription.endpoint,
    p_subscription_json: subscription.toJSON(),
    p_permission_status: 'GRANTED',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw new Error(error.message)
  return { ...result, pushSupported: true, subscription }
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)))
}

export function showQueueNotification(title, body, data = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  new Notification(title, { body, tag: data.bookingId ? `booksaloon-${data.bookingId}` : 'booksaloon-queue', data })
  return true
}
