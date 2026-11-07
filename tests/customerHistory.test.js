import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearCustomerBookingHistory,
  filterCustomerBookingHistory,
} from '../src/services/customerHistory.js'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

test('cleared booking history stays hidden after reload while newer bookings remain visible', () => {
  const storage = new MemoryStorage()
  const clearedAt = Date.parse('2026-11-06T16:30:00.000Z')
  const visible = [
    { id: 'old-1', bookingId: 'old-1', status: 'COMPLETED', created_at: '2026-11-06T16:00:00.000Z' },
    { id: 'old-2', bookingId: 'old-2', status: 'CANCELLED', created_at: '2026-11-06T16:20:00.000Z' },
  ]

  clearCustomerBookingHistory('customer-1', visible, storage, clearedAt)

  const reloadedHistory = [
    ...visible,
    { id: 'new-1', bookingId: 'new-1', status: 'COMPLETED', created_at: '2026-11-06T16:31:00.000Z' },
  ]
  assert.deepEqual(
    filterCustomerBookingHistory('customer-1', reloadedHistory, storage).map((booking) => booking.id),
    ['new-1'],
  )
})

test('cleared booking ids remain hidden when creation timestamps are unavailable', () => {
  const storage = new MemoryStorage()
  clearCustomerBookingHistory('customer-2', [{ id: 'booking-1', status: 'COMPLETED' }], storage, 100)

  assert.deepEqual(
    filterCustomerBookingHistory('customer-2', [
      { id: 'booking-1', status: 'COMPLETED' },
      { id: 'booking-2', status: 'CANCELLED' },
    ], storage).map((booking) => booking.id),
    ['booking-2'],
  )
})

test('clearing completed and cancelled bookings never hides ongoing appointments', () => {
  const storage = new MemoryStorage()
  const bookings = [
    { id: 'done', status: 'COMPLETED', created_at: '2026-11-06T16:00:00.000Z' },
    { id: 'cancelled', status: 'CANCELLED', created_at: '2026-11-06T16:10:00.000Z' },
    { id: 'waiting', status: 'WAITING', created_at: '2026-11-06T15:00:00.000Z' },
    { id: 'in-progress', status: 'IN_PROGRESS', created_at: '2026-11-06T15:00:00.000Z' },
  ]

  assert.equal(clearCustomerBookingHistory('customer-3', bookings, storage, Date.parse('2026-11-06T16:30:00.000Z')), 2)
  assert.deepEqual(
    filterCustomerBookingHistory('customer-3', bookings, storage).map((booking) => booking.id),
    ['waiting', 'in-progress'],
  )
})

test('previous clear markers and hidden ids do not hide ongoing appointments', () => {
  const storage = new MemoryStorage()
  clearCustomerBookingHistory('customer-4', [{ id: 'booking-1', status: 'COMPLETED' }], storage, 100)

  assert.deepEqual(
    filterCustomerBookingHistory('customer-4', [
      { id: 'booking-1', status: 'WAITING', created_at: '1970-01-01T00:00:00.050Z' },
      { id: 'booking-2', status: 'CONFIRMED', created_at: '1970-01-01T00:00:00.050Z' },
      { id: 'booking-3', status: 'COMPLETED', created_at: '1970-01-01T00:00:00.050Z' },
    ], storage).map((booking) => booking.id),
    ['booking-1', 'booking-2'],
  )
})
