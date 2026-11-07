const BOOKING_CLEAR_PREFIX = 'booksaloon-bookings-cleared-before:'
const HIDDEN_BOOKING_PREFIX = 'booksaloon-hidden-bookings:'
const CLEARABLE_BOOKING_STATUSES = new Set(['CANCELLED', 'CANCELED', 'COMPLETED', 'SUCCEEDED'])

function readHiddenBookingIds(userId, storage) {
  try {
    const value = JSON.parse(storage.getItem(`${HIDDEN_BOOKING_PREFIX}${userId}`) || '[]')
    return new Set(Array.isArray(value) ? value : [])
  } catch {
    return new Set()
  }
}

export function isClearableBookingStatus(status) {
  return CLEARABLE_BOOKING_STATUSES.has(String(status || '').toUpperCase())
}

export function clearCustomerBookingHistory(userId, bookings, storage = globalThis.localStorage, clearedAt = Date.now()) {
  if (!userId || !storage) throw new Error('Unable to clear booking history on this device.')
  const clearableBookings = bookings.filter((booking) => isClearableBookingStatus(booking.status))
  if (clearableBookings.length === 0) return 0

  const hiddenIds = readHiddenBookingIds(userId, storage)
  for (const booking of clearableBookings) {
    if (booking.id) hiddenIds.add(booking.id)
    if (booking.bookingId) hiddenIds.add(booking.bookingId)
  }
  storage.setItem(`${HIDDEN_BOOKING_PREFIX}${userId}`, JSON.stringify([...hiddenIds]))
  storage.setItem(`${BOOKING_CLEAR_PREFIX}${userId}`, String(clearedAt))
  return clearableBookings.length
}

export function filterCustomerBookingHistory(userId, bookings, storage = globalThis.localStorage) {
  if (!userId || !storage) return bookings
  const hiddenIds = readHiddenBookingIds(userId, storage)
  const clearedBefore = Number(storage.getItem(`${BOOKING_CLEAR_PREFIX}${userId}`))
  return bookings.filter((booking) => {
    if (!isClearableBookingStatus(booking.status)) return true
    if (hiddenIds.has(booking.id) || hiddenIds.has(booking.bookingId)) return false
    if (!Number.isFinite(clearedBefore) || !booking.created_at) return true
    const createdAt = new Date(booking.created_at).getTime()
    return !Number.isFinite(createdAt) || createdAt > clearedBefore
  })
}
