import assert from 'node:assert/strict'
import test from 'node:test'
import { getAvailableRideApps, openRideApp } from '../src/services/rideBooking.js'

test('provides ride options in a browser', async () => {
  const apps = await getAvailableRideApps({ native: false })
  assert.deepEqual(apps.map((app) => app.name), ['Uber', 'Ola', 'Rapido'])
})

test('passes the destination to an installed native ride app', async () => {
  let call
  await openRideApp('uber', { latitude: 28.5, longitude: 77.3, address: 'Sector 44, Noida' }, {
    native: true,
    plugin: { openRideApp: async (params) => { call = params } },
  })
  assert.deepEqual(call, { appId: 'uber', latitude: 28.5, longitude: 77.3, address: 'Sector 44, Noida' })
  await assert.rejects(openRideApp('ola', {}), /address is not available/)
})
