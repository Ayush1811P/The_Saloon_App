const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
let searchQueue = Promise.resolve()
let lastSearchStartedAt = 0

async function waitForSearchWindow() {
  const nextSearch = searchQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastSearchStartedAt))
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    lastSearchStartedAt = Date.now()
  })
  searchQueue = nextSearch.catch(() => {})
  await nextSearch
}

export async function searchAddress(query, fetchImpl = globalThis.fetch) {
  const search = String(query || '').trim()
  if (search.length < 3) return []
  if (typeof fetchImpl !== 'function') throw new Error('Address search is unavailable in this browser.')

  const url = new URL(NOMINATIM_URL)
  url.search = new URLSearchParams({
    q: search,
    format: 'jsonv2',
    addressdetails: '1',
    countrycodes: 'in',
    limit: '5',
  }).toString()
  await waitForSearchWindow()
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('Address search failed. Please try again.')
  const results = await response.json()
  if (!Array.isArray(results)) throw new Error('Address search returned an invalid response.')

  return results.flatMap((result) => {
    const latitude = Number(result.lat)
    const longitude = Number(result.lon)
    if (!result.display_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    return [{
      label: formatLocationAddress(result),
      latitude,
      longitude,
    }]
  })
}

export async function reverseGeocodeLocation({ latitude, longitude }, fetchImpl = globalThis.fetch) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('A valid location is required to find its address.')
  }
  if (typeof fetchImpl !== 'function') throw new Error('Address lookup is unavailable in this browser.')

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.search = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  }).toString()
  await waitForSearchWindow()
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error('Unable to find the address for this location.')
  const result = await response.json()
  if (!result?.address) throw new Error('No street address was found for this location.')
  return formatLocationAddress(result)
}

export function formatLocationAddress(result) {
  const address = result?.address
  if (!address) return String(result?.display_name || '').split(',').map((part) => part.trim()).filter(Boolean).slice(0, 4).join(', ')

  const parts = [
    address.house_number,
    address.house_name,
    address.building,
    address.industrial,
    address.commercial,
    address.amenity,
    address.shop,
    address.road,
    address.neighbourhood,
    address.suburb,
    address.quarter,
    result.name,
    address.city_district,
    address.district,
    address.state_district,
    address.county,
    address.municipality,
    address.city,
    address.town,
    address.village,
    address.postcode,
    address.state,
  ].filter(Boolean)
  const uniqueParts = parts.filter((part, index) => parts.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index)
  return uniqueParts.join(', ') || String(result.display_name || '').split(',').map((part) => part.trim()).filter(Boolean).slice(0, 4).join(', ')
}

export function combineLocationAddress(details, mapAddress) {
  const parts = [details, mapAddress]
    .flatMap((value) => String(value || '').split(','))
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.filter((part, index) => parts.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index).join(', ')
}

export function createGoogleMapsDirectionsUrl(salon, origin) {
  const hasCoordinates = salon?.latitude != null && salon?.longitude != null
    && String(salon.latitude).trim() !== '' && String(salon.longitude).trim() !== ''
    && Number.isFinite(Number(salon.latitude)) && Number.isFinite(Number(salon.longitude))
  const destination = salon?.location_description || salon?.address_line1 || (hasCoordinates
    ? `${salon.latitude},${salon.longitude}`
    : null)
  if (!destination) return null

  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('destination', destination)
  url.searchParams.set('travelmode', 'driving')
  url.searchParams.set('dir_action', 'navigate')
  if (origin?.address) {
    url.searchParams.set('origin', origin.address)
  } else if (origin?.latitude != null && origin?.longitude != null
      && Number.isFinite(Number(origin.latitude)) && Number.isFinite(Number(origin.longitude))) {
    url.searchParams.set('origin', `${origin.latitude},${origin.longitude}`)
  }
  return url.toString()
}
