export const SMART_LEAVE_CONFIG = Object.freeze({
  averageCitySpeedKmh: 20,
  preparationBufferMinutes: 3,
  roadDetourFactor: 1.3,
  maximumLocationAccuracyMeters: 1000,
  snapshotLifetimeMs: 12 * 60 * 60 * 1000,
  earthRadiusKm: 6371,
})

const STORAGE_PREFIX = 'booksaloon-smart-leave:'
let foregroundLocationPermissionRequest

export function isValidCoordinates(latitude, longitude) {
  if (latitude == null || longitude == null
      || String(latitude).trim() === '' || String(longitude).trim() === '') return false
  const lat = Number(latitude)
  const lon = Number(longitude)
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lon) && lon >= -180 && lon <= 180
}

export function haversineDistanceKm(origin, destination) {
  if (!isValidCoordinates(origin?.latitude, origin?.longitude)
      || !isValidCoordinates(destination?.latitude, destination?.longitude)) {
    return null
  }
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(Number(destination.latitude) - Number(origin.latitude))
  const longitudeDelta = radians(Number(destination.longitude) - Number(origin.longitude))
  const originLatitude = radians(Number(origin.latitude))
  const destinationLatitude = radians(Number(destination.latitude))
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * SMART_LEAVE_CONFIG.earthRadiusKm
    * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
}

export function estimateBikeTravelMinutes(straightLineDistanceKm, options = {}) {
  const distance = Number(straightLineDistanceKm)
  const speed = options.averageCitySpeedKmh ?? SMART_LEAVE_CONFIG.averageCitySpeedKmh
  const detour = options.roadDetourFactor ?? SMART_LEAVE_CONFIG.roadDetourFactor
  if (!Number.isFinite(distance) || distance < 0
      || !Number.isFinite(speed) || speed <= 0
      || !Number.isFinite(detour) || detour < 1) {
    return null
  }
  const roadDistanceKm = distance * detour
  return {
    roadDistanceKm,
    travelMinutes: Math.ceil(roadDistanceKm / speed * 60),
  }
}

export function createTravelEstimate(origin, salonLocation, capturedAt = Date.now()) {
  if (!isValidCoordinates(salonLocation?.latitude, salonLocation?.longitude)) {
    throw new Error('Salon location has not been configured or contains invalid coordinates.')
  }
  if (!isValidCoordinates(origin?.latitude, origin?.longitude)) {
    throw new Error('Your current location is unavailable or invalid.')
  }
  const accuracyMeters = Number(origin.accuracy)
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0
      || accuracyMeters > SMART_LEAVE_CONFIG.maximumLocationAccuracyMeters) {
    throw new Error('Location accuracy is too low. Please try again in a clearer location.')
  }
  const straightLineDistanceKm = haversineDistanceKm(origin, salonLocation)
  const estimate = estimateBikeTravelMinutes(straightLineDistanceKm)
  if (!estimate) throw new Error('Unable to calculate an approximate travel time.')
  return {
    straightLineDistanceKm,
    roadDistanceKm: estimate.roadDistanceKm,
    travelMinutes: estimate.travelMinutes,
    accuracyMeters,
    capturedAt,
  }
}

export function createReminderPlan(expectedStartAt, travelMinutes, now = Date.now()) {
  const startAt = new Date(expectedStartAt).getTime()
  const travel = Number(travelMinutes)
  if (!Number.isFinite(startAt) || !Number.isFinite(travel) || travel < 0) return null
  const requiredMinutes = travel + SMART_LEAVE_CONFIG.preparationBufferMinutes
  const leaveAt = startAt - requiredMinutes * 60_000
  return {
    expectedStartAt: startAt,
    remainingMinutes: Math.max(0, Math.ceil((startAt - now) / 60_000)),
    requiredMinutes,
    leaveAt,
    minutesUntilLeave: Math.ceil((leaveAt - now) / 60_000),
    due: now >= leaveAt,
  }
}

export function getReminderDecision({ status, expectedStartAt, estimate, now = Date.now(), alreadySent = false }) {
  const normalizedStatus = String(status || '').toUpperCase()
  if (['CANCELLED', 'COMPLETED', 'SERVING', 'IN_PROGRESS', 'NO_SHOW', 'SKIPPED'].includes(normalizedStatus)) {
    return { action: 'clear', reason: normalizedStatus.toLowerCase() }
  }
  if (!estimate || !expectedStartAt) return { action: 'cancel-pending', reason: 'estimate-unavailable' }
  if (alreadySent) return { action: 'already-sent', plan: createReminderPlan(expectedStartAt, estimate.travelMinutes, now) }
  const plan = createReminderPlan(expectedStartAt, estimate.travelMinutes, now)
  if (!plan) return { action: 'cancel-pending', reason: 'estimate-unavailable' }
  return { action: plan.due ? 'notify-now' : 'schedule', plan }
}

export function getLeaveReminderNotificationId(bookingId) {
  let hash = 0
  for (const character of String(bookingId)) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  }
  return Math.abs(hash % 2147483647) || 1
}

export function readTravelEstimate(bookingId, storage = globalThis.localStorage, now = Date.now()) {
  if (!storage || !bookingId) return null
  const key = `${STORAGE_PREFIX}${bookingId}`
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null')
    if (!saved || saved.bookingId !== bookingId
        || !Number.isFinite(saved.savedAt)
        || now - saved.savedAt > SMART_LEAVE_CONFIG.snapshotLifetimeMs) {
      storage.removeItem(key)
      return null
    }
    return saved
  } catch {
    storage.removeItem(key)
    return null
  }
}

export function saveTravelEstimate(bookingId, estimate, salon, storage = globalThis.localStorage, now = Date.now()) {
  if (!storage || !bookingId) throw new Error('Unable to save the temporary travel reminder on this device.')
  const saved = {
    bookingId,
    savedAt: now,
    salonName: salon?.name || 'The Saloon',
    locationDescription: salon?.location_description || salon?.address_line1 || '',
    straightLineDistanceKm: estimate.straightLineDistanceKm,
    travelMinutes: estimate.travelMinutes,
    accuracyMeters: estimate.accuracyMeters,
    capturedAt: estimate.capturedAt,
    reminderSentAt: null,
  }
  storage.setItem(`${STORAGE_PREFIX}${bookingId}`, JSON.stringify(saved))
  return saved
}

export function clearTravelEstimate(bookingId, storage = globalThis.localStorage) {
  if (storage && bookingId) storage.removeItem(`${STORAGE_PREFIX}${bookingId}`)
}

export function markReminderSent(bookingId, sentAt = Date.now(), storage = globalThis.localStorage) {
  const saved = readTravelEstimate(bookingId, storage, sentAt)
  if (!saved || saved.reminderSentAt) return saved
  const updated = { ...saved, reminderSentAt: sentAt }
  storage.setItem(`${STORAGE_PREFIX}${bookingId}`, JSON.stringify(updated))
  return updated
}

export async function reconcileSmartLeaveReminder({
  bookingId,
  status,
  expectedStartAt,
  now = Date.now(),
  native = false,
  notifications,
  storage = globalThis.localStorage,
}) {
  const notificationId = getLeaveReminderNotificationId(bookingId)
  const saved = readTravelEstimate(bookingId, storage, now)
  const decision = getReminderDecision({
    status,
    expectedStartAt,
    estimate: saved,
    now,
    alreadySent: Boolean(saved?.reminderSentAt),
  })

  if (decision.action === 'clear') {
    await notifications.cancel(notificationId)
    clearTravelEstimate(bookingId, storage)
    return { status: 'cleared', reason: decision.reason, estimate: null }
  }
  if (decision.action === 'cancel-pending') {
    if (!saved?.reminderSentAt) await notifications.cancel(notificationId)
    return { status: 'unavailable', estimate: saved }
  }
  if (decision.action === 'already-sent') return { status: 'sent', plan: decision.plan, estimate: saved }

  const { plan } = decision
  const title = "It's Time to Leave!"
  const expectedMinutesAtReminder = plan.due ? plan.remainingMinutes : plan.requiredMinutes
  const body = `Your journey to ${saved.salonName} is estimated at ${saved.travelMinutes} minutes. Your appointment is expected to begin in ${expectedMinutesAtReminder} minutes. Get ready and start your journey!`

  if (native) {
    const state = await notifications.getState(notificationId)
    if (state.triggered) {
      markReminderSent(bookingId, now, storage)
      return { status: 'sent', plan, estimate: readTravelEstimate(bookingId, storage, now) }
    }
    const at = plan.due ? new Date(now + 1000) : new Date(plan.leaveAt)
    const result = await notifications.schedule({ id: notificationId, title, body, at, bookingId })
    if (result?.triggered) {
      markReminderSent(bookingId, now, storage)
      return { status: 'sent', plan, estimate: readTravelEstimate(bookingId, storage, now) }
    }
    if (!result?.scheduled) return { status: 'notification-unavailable', plan, estimate: saved }
    if (plan.due) {
      markReminderSent(bookingId, now, storage)
      return { status: 'sent', plan, estimate: readTravelEstimate(bookingId, storage, now) }
    }
    return { status: 'scheduled', plan, estimate: saved }
  }

  if (plan.due) {
    await notifications.show({ id: notificationId, title, body, bookingId })
    markReminderSent(bookingId, now, storage)
    return { status: 'sent', plan, estimate: readTravelEstimate(bookingId, storage, now) }
  }
  return { status: 'scheduled', plan, estimate: saved }
}

export async function getOneTimeLocation({ isNative = false, geolocation = globalThis.navigator?.geolocation } = {}) {
  if (isNative) {
    const { Geolocation } = await import('@capacitor/geolocation')
    let permission = await Geolocation.checkPermissions()
    if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
      permission = await Geolocation.requestPermissions({ permissions: ['location'] })
    }
    if (permission.location !== 'granted') throw new Error('Location permission was not granted.')
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    })
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    }
  }
  if (!geolocation?.getCurrentPosition) {
    throw new Error('Location is unavailable in this browser. You can continue without the reminder.')
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords, timestamp }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        timestamp,
      }),
      (error) => {
        const message = error.code === 1
          ? 'Location permission was denied. You can continue without the reminder.'
          : error.code === 2
            ? 'Your location is unavailable. You can continue without the reminder.'
            : error.code === 3
              ? 'Location request timed out. Please try again or continue without the reminder.'
              : 'Unable to get your location. You can continue without the reminder.'
        reject(new Error(message))
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  })
}

export async function requestForegroundLocationPermission({ isNative = false } = {}) {
  if (!isNative) return { supported: false, granted: false }
  if (!foregroundLocationPermissionRequest) {
    foregroundLocationPermissionRequest = (async () => {
      const { Geolocation } = await import('@capacitor/geolocation')
      let permission = await Geolocation.checkPermissions()
      if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
        permission = await Geolocation.requestPermissions({ permissions: ['location'] })
      }
      return { supported: true, granted: permission.location === 'granted' }
    })()
  }
  try {
    return await foregroundLocationPermissionRequest
  } catch (error) {
    foregroundLocationPermissionRequest = undefined
    throw error
  }
}
