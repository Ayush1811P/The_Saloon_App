import assert from 'node:assert/strict'
import test from 'node:test'
import {
  combineLocationAddress,
  createGoogleMapsDirectionsUrl,
  formatLocationAddress,
  reverseGeocodeLocation,
  searchAddress,
} from '../src/services/addressSearch.js'

test('searches and validates address results', async () => {
  let requestedUrl
  const results = await searchAddress('Sector 18, Noida', async (url) => {
    requestedUrl = new URL(url)
    return {
      ok: true,
      async json() {
        return [
          {
            display_name: 'Sector 18, Noida, Uttar Pradesh, India',
            address: { suburb: 'Sector 18', city: 'Noida', state: 'Uttar Pradesh' },
            lat: '28.5708',
            lon: '77.3261',
          },
          { display_name: '', lat: 'bad', lon: '0' },
        ]
      },
    }
  })
  assert.equal(requestedUrl.searchParams.get('countrycodes'), 'in')
  assert.equal(results.length, 1)
  assert.deepEqual(results[0], {
    label: 'Sector 18, Noida, Uttar Pradesh',
    latitude: 28.5708,
    longitude: 77.3261,
  })

  test('reverse geocodes a location to a human-readable address without showing coordinates', async () => {
    const address = await reverseGeocodeLocation({ latitude: 28.5, longitude: 77.3 }, async (url) => {
      assert.equal(new URL(url).pathname, '/reverse')
      return {
        ok: true,
        async json() {
          return {
            display_name: 'F Block, Sector 44, Noida, Uttar Pradesh, India',
            address: { neighbourhood: 'F Block', suburb: 'Sector 44', city: 'Noida', state: 'Uttar Pradesh' },
          }
        },
      }
    })
    assert.equal(address, 'F Block, Sector 44, Noida, Uttar Pradesh')
    assert.equal(formatLocationAddress({ address: { city: 'Noida', town: 'Noida', state: 'Uttar Pradesh' } }), 'Noida, Uttar Pradesh')
    await assert.rejects(reverseGeocodeLocation({ latitude: 100, longitude: 77 }), /valid location/)
  })
})

test('skips short searches and reports address provider failures', async () => {
  assert.deepEqual(await searchAddress('No'), [])
  await assert.rejects(
    searchAddress('Noida', async () => ({ ok: false })),
    /Address search failed/,
  )
})

test('formats precise house, building, sector, district, city, and state components', () => {
  assert.equal(formatLocationAddress({
    name: 'F Block Market',
    address: {
      house_number: '12',
      building: 'Tower A',
      road: 'Sector 44 Road',
      neighbourhood: 'F Block',
      state_district: 'Gautam Buddha Nagar',
      city: 'Noida',
      state: 'Uttar Pradesh',
    },
  }), '12, Tower A, Sector 44 Road, F Block, F Block Market, Gautam Buddha Nagar, Noida, Uttar Pradesh')
  assert.equal(
    combineLocationAddress('House 12, 2nd Floor, F Block', 'F Block, Sector 44, Noida, Uttar Pradesh'),
    'House 12, 2nd Floor, F Block, Sector 44, Noida, Uttar Pradesh',
  )
})

test('creates a Google Maps navigation URL with optional live origin', () => {
  const url = new URL(createGoogleMapsDirectionsUrl(
    { latitude: 28.5708, longitude: 77.3261 },
    { latitude: 28.5355, longitude: 77.391 },
  ))
  assert.equal(url.hostname, 'www.google.com')
  assert.equal(url.searchParams.get('destination'), '28.5708,77.3261')
  assert.equal(url.searchParams.get('origin'), '28.5355,77.391')
  assert.equal(createGoogleMapsDirectionsUrl({}), null)
})
