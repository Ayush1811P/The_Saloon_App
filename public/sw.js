self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data?.text() || '' } }
  event.waitUntil(self.registration.showNotification(payload.title || 'BOOKSALOON queue update', {
    body: payload.body || 'Your live queue status has changed.',
    tag: payload.bookingId ? `booksaloon-${payload.bookingId}` : 'booksaloon-queue',
    data: { url: payload.bookingId ? `/customer/queue/${payload.bookingId}` : '/customer/bookings' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/customer/bookings'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pages) => {
    const page = pages.find((candidate) => 'focus' in candidate)
    if (page) {
      page.navigate(target)
      return page.focus()
    }
    return clients.openWindow(target)
  }))
})
