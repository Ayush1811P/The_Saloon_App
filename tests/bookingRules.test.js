import assert from 'node:assert/strict'
import test from 'node:test'
import { hasActiveBooking, isActiveBookingStatus } from '../src/services/bookingRules.js'

test('treats every non-terminal appointment status as active', () => {
  for (const status of ['PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS']) {
    assert.equal(isActiveBookingStatus(status), true)
  }
  for (const status of ['CANCELLED', 'COMPLETED', 'NO_SHOW']) {
    assert.equal(isActiveBookingStatus(status), false)
  }
})

test('finds an active booking in a customer history', () => {
  assert.equal(hasActiveBooking([{ status: 'COMPLETED' }, { status: 'WAITING' }]), true)
  assert.equal(hasActiveBooking([{ status: 'CANCELLED' }, { status: 'NO_SHOW' }]), false)
})
