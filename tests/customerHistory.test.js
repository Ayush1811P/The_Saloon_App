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
    { id: 'old-1', bookingId: 'old-1', created_at: '2026-11-06T16:00:00.000Z' },
    { id: 'old-2', bookingId: 'old-2', created_at: '2026-11-06T16:20:00.000Z' },
  ]

  clearCustomerBookingHistory('customer-1', visible, storage, clearedAt)

  const reloadedHistory = [
    ...visible,
    { id: 'new-1', bookingId: 'new-1', created_at: '2026-11-06T16:31:00.000Z' },
  ]
  assert.deepEqual(
    filterCustomerBookingHistory('customer-1', reloadedHistory, storage).map((booking) => booking.id),
    ['new-1'],
  )
})

test('cleared booking ids remain hidden when creation timestamps are unavailable', () => {
  const storage = new MemoryStorage()
  clearCustomerBookingHistory('customer-2', [{ id: 'booking-1' }], storage, 100)

  assert.deepEqual(
    filterCustomerBookingHistory('customer-2', [
      { id: 'booking-1' },
      { id: 'booking-2' },
    ], storage).map((booking) => booking.id),
    ['booking-2'],
  )
})
