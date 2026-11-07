const ACTIVE_BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'WAITING',
  'BARBER_ASSIGNED',
  'IN_PROGRESS',
])

export function isActiveBookingStatus(status) {
  return ACTIVE_BOOKING_STATUSES.has(String(status || '').toUpperCase())
}

export function hasActiveBooking(bookings = []) {
  return bookings.some((booking) => isActiveBookingStatus(booking.status))
}
