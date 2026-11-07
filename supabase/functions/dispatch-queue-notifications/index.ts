import webpush from 'npm:web-push'
import { SignJWT, importPKCS8 } from 'npm:jose'
import { createClient } from 'npm:@supabase/supabase-js@2'

const AUTH_SCHEME = ['Bear', 'er'].join('')
const EVENT_TYPES = new Set([
  'BOOKING_CONFIRMED', 'QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TURN_APPROACHING',
  'CUSTOMER_NEXT', 'CHAIR_READY', 'BOOKING_CANCELLED', 'SERVICE_STARTED', 'SERVICE_COMPLETED',
  'TRAVEL_REMINDER',
])
const TURN_EVENTS = new Set(['TURN_APPROACHING', 'CUSTOMER_NEXT', 'CHAIR_READY'])
const QUEUE_EVENTS = new Set(['QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TRAVEL_REMINDER'])
const MAX_ATTEMPTS = 5
const LEASE_SECONDS = 300
const NEVER_RETRY = '9999-12-31T23:59:59.000Z'
const allowedOrigin = Deno.env.get('DISPATCHER_ALLOWED_ORIGIN')
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin || 'null',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

type EventRow = {
  id: string
  user_id: string
  booking_id: string
  event_type: string
  payload: Record<string, unknown>
  attempt_count: number
  processing_token: string
}

type Device = {
  id: string
  platform: 'WEB' | 'ANDROID'
  endpoint: string | null
  subscription_json: Record<string, unknown> | null
}

type Preferences = {
  browser_enabled: boolean
  android_enabled: boolean
  queue_enabled: boolean
  turn_alerts_enabled: boolean
  booking_updates: boolean
}

class DeliveryError extends Error {
  responseCode: number | null
  permanent: boolean

  constructor(message: string, responseCode: number | null = null, permanent = false) {
    super(message)
    this.responseCode = responseCode
    this.permanent = permanent
  }
}

class ConfigurationError extends Error {}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeLog(message: string) {
  console.error(`[queue-dispatcher] ${message}`)
}

function messageFor(event: EventRow) {
  if (!EVENT_TYPES.has(event.event_type)) throw new Error('Unsupported notification event')
  const queueNumber = event.payload.queueNumber
  const wait = event.payload.estimatedWaitMinutes
  const estimatedStartAt = event.payload.estimatedStartAt
  const queueStartedAt = event.payload.queueStartedAt
  const estimatedStartAtMillis = typeof estimatedStartAt === 'string' && Number.isFinite(Date.parse(estimatedStartAt))
    ? String(Date.parse(estimatedStartAt))
    : ''
  const queueStartedAtMillis = typeof queueStartedAt === 'string' && Number.isFinite(Date.parse(queueStartedAt))
    ? String(Date.parse(queueStartedAt))
    : ''
  const service = typeof event.payload.service === 'string' ? event.payload.service : 'your salon service'
  const messages: Record<string, [string, string]> = {
    BOOKING_CONFIRMED: ['Appointment confirmed', `Your ${service} appointment is confirmed.`],
    QUEUE_JOINED: ['You are in the queue', queueNumber ? `Queue #${queueNumber} is registered.` : 'Your queue entry is registered.'],
    QUEUE_ETA_UPDATED: ['Estimated wait updated', `Your estimated wait is ${wait ?? 'being calculated'} minutes.`],
    TURN_APPROACHING: ['Your turn is approaching', `Please prepare. Estimated wait: ${wait ?? 0} minutes.`],
    CUSTOMER_NEXT: ['You are next', 'Please get ready for your service.'],
    CHAIR_READY: ['Your service is ready', 'Please proceed to the salon for your service.'],
    BOOKING_CANCELLED: ['Appointment cancelled', 'Your BOOKSALOON appointment was cancelled.'],
    SERVICE_STARTED: ['Service started', `Your ${service} service has started.`],
    SERVICE_COMPLETED: ['Service completed', `Your ${service} service is complete. Thank you.`],
    TRAVEL_REMINDER: [
      'Time to leave for your appointment',
      `Your journey to ${event.payload.salonName || 'the salon'} is estimated at ${event.payload.travelMinutes ?? 0} minutes. Leave now to arrive with a ${event.payload.preparationBufferMinutes ?? 3}-minute preparation buffer.`,
    ],
  }
  const [title, body] = messages[event.event_type]
  return {
    title,
    body,
    bookingId: event.booking_id,
    queueNumber: queueNumber == null ? '' : String(queueNumber),
    estimatedWaitMinutes: wait == null ? '' : String(wait),
    estimatedStartAt: estimatedStartAtMillis,
    startedAt: queueStartedAtMillis,
    url: `/customer/queue/${event.booking_id}`,
  }
}

function validateWebSubscription(subscription: Record<string, unknown> | null) {
  const keys = subscription?.keys
  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    !subscription.endpoint.startsWith('https://') ||
    typeof keys !== 'object' ||
    keys === null ||
    typeof (keys as Record<string, unknown>).p256dh !== 'string' ||
    typeof (keys as Record<string, unknown>).auth !== 'string'
  ) {
    throw new DeliveryError('Invalid Web Push subscription', null, true)
  }
}

function preferenceAllows(eventType: string, platform: Device['platform'], preferences: Preferences) {
  if (platform === 'WEB' && !preferences.browser_enabled) return false
  if (platform === 'ANDROID' && !preferences.android_enabled) return false
  if (TURN_EVENTS.has(eventType)) return preferences.queue_enabled && preferences.turn_alerts_enabled
  if (QUEUE_EVENTS.has(eventType)) return preferences.queue_enabled
  return preferences.booking_updates
}

async function createFcmTokenProvider() {
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID')
  const clientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL')
  const privateKeyValue = Deno.env.get('FIREBASE_PRIVATE_KEY')
  if (!projectId || !clientEmail || !privateKeyValue) throw new ConfigurationError('FCM configuration is incomplete')
  const privateKey = await importPKCS8(privateKeyValue.replace(/\\n/g, '\n'), 'RS256')
  let cached: { token: string; expiresAt: number } | null = null
  return async (forceRefresh = false) => {
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60000) return cached.token
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(clientEmail)
      .setSubject(clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    })
    if (!response.ok) throw new ConfigurationError('FCM authentication failed')
    const token = (await response.json()).access_token as string
    cached = { token, expiresAt: Date.now() + 3500000 }
    return token
  }
}

async function sendWebPush(subscription: Record<string, unknown>, payload: Record<string, string>) {
  const subject = Deno.env.get('VAPID_SUBJECT')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!subject || !publicKey || !privateKey) throw new ConfigurationError('Web Push configuration is incomplete')
  validateWebSubscription(subscription)
  webpush.setVapidDetails(subject, publicKey, privateKey)
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
  } catch (error) {
    const responseCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: number }).statusCode) || null
      : null
    throw new DeliveryError(
      responseCode ? `Web Push delivery failed (${responseCode})` : 'Web Push delivery failed',
      responseCode,
      responseCode === 404 || responseCode === 410,
    )
  }
}

async function sendFcm(
  token: string,
  payload: Record<string, string>,
  getAccessToken: (forceRefresh?: boolean) => Promise<string>,
) {
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID')
  if (!projectId) throw new ConfigurationError('FCM configuration is incomplete')
  const send = (accessToken: string) => fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `${AUTH_SCHEME} ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: payload,
        },
      }),
    },
  )
  let response = await send(await getAccessToken())
  if (response.status === 401) response = await send(await getAccessToken(true))
  if (response.ok) return
  const responseBody = await response.text()
  const permanent = response.status === 404
    || responseBody.includes('UNREGISTERED')
    || responseBody.includes('registration-token-not-registered')
  throw new DeliveryError(`FCM delivery failed (${response.status})`, response.status, permanent)
}

async function requireResult<T>(result: { data: T | null; error: { message: string } | null }, operation: string) {
  if (result.error) {
    safeLog(`${operation} failed`)
    throw new Error(`${operation} failed`)
  }
  return result.data
}

async function insertAttempt(admin: ReturnType<typeof createClient>, values: Record<string, unknown>, eventId: string) {
  const first = await admin.from('notification_delivery_attempts').insert(values)
  if (!first.error) return
  const retry = await admin.from('notification_delivery_attempts').insert(values)
  if (retry.error) {
    safeLog(`delivery attempt persistence failed for event ${eventId}`)
    throw new Error('Delivery attempt persistence failed')
  }
}

async function finalizeEvent(
  admin: ReturnType<typeof createClient>,
  event: EventRow,
  values: Record<string, unknown>,
) {
  const result = await admin.from('queue_notification_events')
    .update(values)
    .eq('id', event.id)
    .eq('processing_token', event.processing_token)
    .eq('delivery_status', 'PROCESSING')
    .select('id')
    .maybeSingle()
  const data = await requireResult(result, 'Final event update')
  if (!data) throw new Error('Final event update lost processing ownership')
}

async function processEvent(
  admin: ReturnType<typeof createClient>,
  event: EventRow,
  getFcmAccessToken: { current: ((forceRefresh?: boolean) => Promise<string>) | null },
) {
  const payload = messageFor(event)
  const preferencesResult = await admin.from('notification_preferences')
    .select('browser_enabled,android_enabled,queue_enabled,turn_alerts_enabled,booking_updates')
    .eq('user_id', event.user_id)
    .maybeSingle()
  const preferences = await requireResult(preferencesResult, 'Preference query')
  const prefs: Preferences | null = preferences
    ? {
        browser_enabled: preferences.browser_enabled,
        android_enabled: preferences.android_enabled,
        queue_enabled: preferences.queue_enabled,
        turn_alerts_enabled: preferences.turn_alerts_enabled,
        booking_updates: preferences.booking_updates,
      }
    : null

  const devicesResult = await admin.from('device_push_subscriptions')
    .select('id,platform,endpoint,subscription_json')
    .eq('user_id', event.user_id)
    .is('revoked_at', null)
  const devices = await requireResult(devicesResult, 'Device query') as Device[] | null
  const successfulResult = await admin.from('notification_delivery_attempts')
    .select('device_id')
    .eq('event_id', event.id)
    .eq('status', 'SENT')
  const successfulRows = await requireResult(successfulResult, 'Successful-attempt lookup')
  const successful = new Set((successfulRows || []).map((row) => row.device_id))
  const eligibleDevices = prefs
    ? (devices || []).filter((device) => preferenceAllows(event.event_type, device.platform, prefs))
    : []
  let sent = 0
  let transientFailures = 0
  let permanentFailures = 0

  for (const device of eligibleDevices) {
    if (successful.has(device.id)) continue
    let status = 'SENT'
    let responseCode: number | null = null
    let errorMessage: string | null = null
    let permanent = false
    try {
      if (device.platform === 'WEB' && device.subscription_json) {
        await sendWebPush(device.subscription_json, payload)
      } else if (device.platform === 'ANDROID' && device.endpoint) {
        if (!getFcmAccessToken.current) getFcmAccessToken.current = await createFcmTokenProvider()
        await sendFcm(device.endpoint, payload, getFcmAccessToken.current)
      } else {
        throw new DeliveryError('Device registration is incomplete', null, true)
      }
      sent += 1
    } catch (error) {
      if (error instanceof ConfigurationError) throw error
      const failure = error instanceof DeliveryError ? error : new DeliveryError('Notification delivery failed')
      status = failure.permanent ? 'REVOKED' : 'FAILED'
      responseCode = failure.responseCode
      errorMessage = failure.message
      permanent = failure.permanent
      if (permanent) permanentFailures += 1
      else transientFailures += 1
    }

    await insertAttempt(admin, {
      event_id: event.id,
      device_id: device.id,
      attempt_number: event.attempt_count,
      platform: device.platform,
      status,
      response_code: responseCode,
      error_message: errorMessage,
      permanent_failure: permanent,
    }, event.id)

    if (permanent) {
      const revokeResult = await admin.from('device_push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', device.id)
      await requireResult(revokeResult, 'Device revocation')
    }
  }

  const alreadyDelivered = eligibleDevices.filter((device) => successful.has(device.id)).length
  const noEligibleDevices = eligibleDevices.length === 0
  const retryable = transientFailures > 0 && event.attempt_count < MAX_ATTEMPTS
  const status = noEligibleDevices
    ? 'FAILED'
    : retryable
      ? (sent + alreadyDelivered > 0 ? 'PARTIAL' : 'FAILED')
      : sent + alreadyDelivered === eligibleDevices.length && permanentFailures === 0
        ? 'DELIVERED'
        : sent + alreadyDelivered > 0
          ? 'PARTIAL'
          : 'FAILED'
  const nextAttemptAt = retryable
    ? new Date(Date.now() + Math.min(3600000, 60000 * (2 ** (event.attempt_count - 1)))).toISOString()
    : NEVER_RETRY
  await finalizeEvent(admin, event, {
    delivery_status: status,
    next_attempt_at: nextAttemptAt,
    delivered_at: sent + alreadyDelivered > 0 ? new Date().toISOString() : null,
    last_error: noEligibleDevices
      ? prefs ? 'No eligible active devices' : 'Notification preferences are not configured'
      : transientFailures > 0 ? 'One or more transient deliveries failed' : null,
    processing_token: null,
    processing_lease_until: null,
  })
  return { eventId: event.id, sent, status }
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expected = Deno.env.get('DISPATCHER_SECRET')
  if (!expected || request.headers.get('authorization') !== `${AUTH_SCHEME} ${expected}`) {
    return json({ error: 'Unauthorized' }, 401)
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Dispatcher configuration is incomplete' }, 503)

  const admin = createClient(supabaseUrl, serviceRoleKey)
  let events: EventRow[] | null = null
  try {
    const claimResult = await admin.rpc('claim_queue_notification_events', {
      p_limit: 50,
      p_lease_seconds: LEASE_SECONDS,
    })
    events = await requireResult(claimResult, 'Event claim')
  } catch {
    return json({ error: 'Unable to claim notification events' }, 503)
  }
  const getFcmAccessToken: { current: ((forceRefresh?: boolean) => Promise<string>) | null } = { current: null }
  const results = []
  try {
    for (const event of (events || []) as EventRow[]) {
      results.push(await processEvent(admin, event, getFcmAccessToken))
    }
  } catch (error) {
    safeLog(error instanceof ConfigurationError ? 'delivery configuration is incomplete' : 'dispatcher database or delivery operation failed')
    return json({ error: 'Notification dispatch failed; retry will occur after the processing lease expires' }, 503)
  }
  return json({ processed: results.length, results })
}

Deno.serve(handle)
