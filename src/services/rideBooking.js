const RIDE_APPS = [
  { id: 'uber', name: 'Uber', packageName: 'com.ubercab' },
  { id: 'ola', name: 'Ola', packageName: 'com.olacabs.customer' },
  { id: 'rapido', name: 'Rapido', packageName: 'com.rapido.passenger' },
]

export async function getAvailableRideApps({ native = false, plugin = globalThis.window?.Capacitor?.Plugins?.QueueNotification } = {}) {
  if (native) {
    if (!plugin?.getRideApps) throw new Error('Ride apps are unavailable in this app version.')
    const result = await plugin.getRideApps()
    return Array.isArray(result?.apps) ? result.apps : []
  }

  return RIDE_APPS.map(({ id, name }) => ({ id, name }))
}

export async function openRideApp(appId, destination, { native = false, plugin = globalThis.window?.Capacitor?.Plugins?.QueueNotification } = {}) {
  if (destination?.latitude == null || destination?.longitude == null
      || !Number.isFinite(Number(destination.latitude)) || !Number.isFinite(Number(destination.longitude))) {
    throw new Error('The salon address is not available for ride booking.')
  }
  const app = RIDE_APPS.find((item) => item.id === appId)
  if (!app) throw new Error('Choose a supported ride app.')

  if (native) {
    if (!plugin?.openRideApp) throw new Error('Ride apps are unavailable in this app version.')
    return plugin.openRideApp({
      appId,
      latitude: Number(destination.latitude),
      longitude: Number(destination.longitude),
      address: destination.address || '',
    })
  }

  const url = appId === 'uber'
    ? `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${encodeURIComponent(destination.latitude)}&dropoff[longitude]=${encodeURIComponent(destination.longitude)}`
    : appId === 'ola'
      ? `https://book.olacabs.com/?drop_lat=${encodeURIComponent(destination.latitude)}&drop_lng=${encodeURIComponent(destination.longitude)}&drop_name=${encodeURIComponent(destination.address || '')}`
      : `https://www.rapido.bike/?drop_lat=${encodeURIComponent(destination.latitude)}&drop_lng=${encodeURIComponent(destination.longitude)}`
  globalThis.window.open(url, '_blank', 'noopener,noreferrer')
  return { opened: true }
}
