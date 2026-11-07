import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SMART_LEAVE_CONFIG,
  clearTravelEstimate,
  createReminderPlan,
  createTravelEstimate,
  estimateBikeTravelMinutes,
  getLeaveReminderNotificationId,
  getOneTimeLocation,
  haversineDistanceKm,
  isValidCoordinates,
  readTravelEstimate,
  reconcileSmartLeaveReminder,
  requestForegroundLocationPermission,
  saveTravelEstimate,
} from '../src/services/smartLeaveReminder.js'

const now = Date.parse('2026-11-06T16:30:00.000Z')

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function makeSavedEstimate(storage, bookingId = 'booking-123', travelMinutes = 10) {
  return saveTravelEstimate(bookingId, {
    straightLineDistanceKm: 2.56,
    roadDistanceKm: 3.33,
    travelMinutes,
    accuracyMeters: 25,
    capturedAt: now,
  }, { name: 'The Saloon', location_description: 'Main Street' }, storage, now)
}

function makeNotifications() {
  const calls = { scheduled: [], cancelled: [], shown: [], triggered: false }
  return {
    calls,
    async schedule(notification) {
      calls.scheduled.push(notification)
      return { scheduled: true }
    },
    async getState() {
      return { triggered: calls.triggered, scheduled: calls.scheduled.at(-1) || null }
    },
    async cancel(id) {
      calls.cancelled.push(id)
      calls.scheduled = []
      calls.triggered = false
    },
    async show(notification) {
      calls.shown.push(notification)
      return { supported: true }
    },
  }
}

test('validates coordinates and rejects missing values', () => {
  assert.equal(isValidCoordinates(90, 180), true)
  assert.equal(isValidCoordinates(-90, -180), true)
  assert.equal(isValidCoordinates('', 0), false)
  assert.equal(isValidCoordinates(null, 0), false)
  assert.equal(isValidCoordinates(90.01, 0), false)
  assert.equal(isValidCoordinates(0, -180.01), false)
})

test('calculates Haversine distance and returns no estimate for invalid coordinates', () => {
  assert.equal(haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0)
  assert.ok(Math.abs(haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) - 111.19) < 0.1)
  assert.equal(haversineDistanceKm({ latitude: '', longitude: 0 }, { latitude: 0, longitude: 0 }), null)
})

test('calculates the approximate bike time with detour and rounds upward', () => {
  const estimate = estimateBikeTravelMinutes(2.5641025641)
  assert.equal(estimate.travelMinutes, 10)
  assert.ok(Math.abs(estimate.roadDistanceKm - 3.3333333333) < 0.001)
  assert.equal(estimateBikeTravelMinutes(-1), null)
})

test('creates a validated one-time travel estimate without retaining origin coordinates', () => {
  const estimate = createTravelEstimate(
    { latitude: 12.9716, longitude: 77.5946, accuracy: 18 },
    { latitude: 12.9716, longitude: 77.5946 },
    now,
  )
  assert.equal(estimate.travelMinutes, 0)
  assert.equal(estimate.accuracyMeters, 18)
  assert.equal(Object.hasOwn(estimate, 'latitude'), false)
  assert.throws(() => createTravelEstimate(
    { latitude: 0, longitude: 0, accuracy: 1001 },
    { latitude: 0, longitude: 0 },
    now,
  ), /accuracy is too low/)
  assert.throws(() => createTravelEstimate(
    { latitude: 0, longitude: 0, accuracy: 1 },
    { latitude: null, longitude: 0 },
    now,
  ), /Salon location/)
})

test('captures one-time web location and handles user-denied permission', async () => {
  const grantedGeolocation = {
    getCurrentPosition(resolve, _reject, options) {
      assert.equal(options.enableHighAccuracy, true)
      resolve({ coords: { latitude: 1, longitude: 2, accuracy: 12 }, timestamp: now })
    },
  }
  assert.deepEqual(await getOneTimeLocation({ geolocation: grantedGeolocation }), {
    latitude: 1, longitude: 2, accuracy: 12, timestamp: now,
  })
  const deniedGeolocation = {
    getCurrentPosition(_resolve, reject) { reject({ code: 1 }) },
  }
  await assert.rejects(getOneTimeLocation({ geolocation: deniedGeolocation }), /permission was denied/)
})

test('does not request foreground location permission from a browser app shell', async () => {
  assert.deepEqual(await requestForegroundLocationPermission(), { supported: false, granted: false })
})

test('adds the three-minute preparation buffer and triggers at the 13-minute threshold', () => {
  assert.equal(SMART_LEAVE_CONFIG.preparationBufferMinutes, 3)
  const plan = createReminderPlan(new Date(now + 13 * 60_000).toISOString(), 10, now)
  assert.equal(plan.requiredMinutes, 13)
  assert.equal(plan.due, true)
  assert.equal(plan.leaveAt, now)
  assert.equal(plan.remainingMinutes, 13)
})

test('schedules and recalculates reminders when the live queue ETA changes earlier or later', async () => {
  const storage = new MemoryStorage()
  makeSavedEstimate(storage)
  const notifications = makeNotifications()
  const firstEta = new Date(now + 30 * 60_000).toISOString()
  const first = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING', expectedStartAt: firstEta,
    now, native: true, notifications, storage,
  })
  assert.equal(first.status, 'scheduled')
  assert.equal(notifications.calls.scheduled.at(-1).at.getTime(), now + 17 * 60_000)

  const earlierEta = new Date(now + 15 * 60_000).toISOString()
  const earlier = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING', expectedStartAt: earlierEta,
    now, native: true, notifications, storage,
  })
  assert.equal(earlier.status, 'scheduled')
  assert.equal(notifications.calls.scheduled.at(-1).at.getTime(), now + 2 * 60_000)

  const delayedEta = new Date(now + 28 * 60_000).toISOString()
  const delayed = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING', expectedStartAt: delayedEta,
    now, native: true, notifications, storage,
  })
  assert.equal(delayed.status, 'scheduled')
  assert.equal(notifications.calls.scheduled.at(-1).at.getTime(), now + 15 * 60_000)
})

test('fires a due reminder once and does not repeat it when the queue estimate changes', async () => {
  const storage = new MemoryStorage()
  makeSavedEstimate(storage)
  const notifications = makeNotifications()
  const eta = new Date(now + 13 * 60_000).toISOString()
  const first = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING', expectedStartAt: eta,
    now, notifications, storage,
  })
  assert.equal(first.status, 'sent')
  assert.match(notifications.calls.shown[0].body, /10 minutes/)
  assert.match(notifications.calls.shown[0].body, /13 minutes/)

  const delayed = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING',
    expectedStartAt: new Date(now + 28 * 60_000).toISOString(),
    now: now + 30_000, notifications, storage,
  })
  assert.equal(delayed.status, 'sent')
  assert.equal(notifications.calls.shown.length, 1)
})

test('Android local notification is scheduled once and cancelled on booking cancellation', async () => {
  const storage = new MemoryStorage()
  makeSavedEstimate(storage)
  const notifications = makeNotifications()
  const eta = new Date(now + 30 * 60_000).toISOString()
  await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'WAITING', expectedStartAt: eta,
    now, native: true, notifications, storage,
  })
  const cancelled = await reconcileSmartLeaveReminder({
    bookingId: 'booking-123', status: 'CANCELLED', expectedStartAt: eta,
    now, native: true, notifications, storage,
  })
  assert.equal(cancelled.status, 'cleared')
  assert.equal(notifications.calls.cancelled[0], getLeaveReminderNotificationId('booking-123'))
  assert.equal(readTravelEstimate('booking-123', storage, now), null)
})

test('completion, missing ETA, denied web notification and explicit disable are handled', async () => {
  const storage = new MemoryStorage()
  makeSavedEstimate(storage, 'booking-456')
  const notifications = makeNotifications()
  const missingEta = await reconcileSmartLeaveReminder({
    bookingId: 'booking-456', status: 'WAITING', expectedStartAt: null,
    now, native: true, notifications, storage,
  })
  assert.equal(missingEta.status, 'unavailable')
  assert.equal(notifications.calls.cancelled.length, 1)

  const deniedNotifications = makeNotifications()
  deniedNotifications.show = async () => ({ supported: false, reason: 'permission denied' })
  const due = await reconcileSmartLeaveReminder({
    bookingId: 'booking-456', status: 'WAITING',
    expectedStartAt: new Date(now + 13 * 60_000).toISOString(),
    now, notifications: deniedNotifications, storage,
  })
  assert.equal(due.status, 'notification-unavailable')
  assert.equal(deniedNotifications.calls.shown.length, 0)

  const completed = await reconcileSmartLeaveReminder({
    bookingId: 'booking-456', status: 'COMPLETED', expectedStartAt: null,
    now, notifications, storage,
  })
  assert.equal(completed.status, 'cleared')
  assert.equal(readTravelEstimate('booking-456', storage, now), null)

  makeSavedEstimate(storage, 'booking-disabled')
  await notifications.cancel(getLeaveReminderNotificationId('booking-disabled'))
  clearTravelEstimate('booking-disabled', storage)
  assert.equal(readTravelEstimate('booking-disabled', storage, now), null)
})

test('clears expired device-local estimate and uses a stable notification identifier', () => {
  const storage = new MemoryStorage()
  makeSavedEstimate(storage, 'booking-ttl')
  assert.ok(readTravelEstimate('booking-ttl', storage, now))
  assert.equal(readTravelEstimate('booking-ttl', storage, now + SMART_LEAVE_CONFIG.snapshotLifetimeMs + 1), null)
  assert.equal(getLeaveReminderNotificationId('booking-ttl'), getLeaveReminderNotificationId('booking-ttl'))
})
