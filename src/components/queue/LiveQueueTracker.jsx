import { useEffect, useMemo, useState } from 'react'
import { Bell, WifiOff } from 'lucide-react'
import { getLiveQueueBooking, getProgressPercent, getRemainingMinutes, subscribeToQueueBooking } from '../../services/queueTrackerService'
import { registerWebDevice, showQueueNotification } from '../../services/notificationService'
import { initializeAndroidNotifications, publishQueueNotification } from '../../services/platformNotificationAdapter'

function statusLabel(status) {
  return { WAITING: 'Waiting in queue', CALLED: 'Your turn is next', SERVING: 'Service in progress', COMPLETED: 'Service completed', CANCELLED: 'Appointment cancelled' }[status] || status
}

export default function LiveQueueTracker({ bookingId, userId }) {
  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [now, setNow] = useState(Date.now())

  const load = async () => {
    try {
      const next = await getLiveQueueBooking(bookingId, userId)
      setEntry(next)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const cleanup = subscribeToQueueBooking(bookingId, load)
    const tick = window.setInterval(() => setNow(Date.now()), 30000)
    const online = () => { setOffline(false); load() }
    const offlineHandler = () => setOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', offlineHandler)
    return () => {
      cleanup()
      window.clearInterval(tick)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offlineHandler)
    }
  }, [bookingId, userId])

  const remaining = useMemo(() => entry ? getRemainingMinutes(entry.estimated_start_at) : null, [entry, now])
  const progress = entry ? getProgressPercent(entry) : 0
  const salon = entry?.booking?.salon
  const service = entry?.booking?.booking_items?.map((item) => item.service_name_snapshot).join(', ')
  const barber = entry?.booking?.booking_staff?.[0]?.employee?.employee_name

  if (loading) return <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Loading live queue...</p>
  if (error) return <p className="rounded-2xl bg-rose-50 p-5 text-sm text-rose-700">{error}</p>
  if (!entry) return <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">This booking is no longer in the live queue.</p>

  return (
    <section className="space-y-4 pb-24">
      {offline && <div className="flex items-center gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800"><WifiOff size={16} /> Offline. Showing the last known estimate.</div>}
      <div className="rounded-[30px] bg-[#0b1220] p-6 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d9b78c]">BOOKSALOON live queue</p>
        <h1 className="mt-2 text-3xl font-black">{salon?.name || 'Salon'}</h1>
        <p className="mt-2 text-slate-300">{salon?.city || ''} {service ? `• ${service}` : ''}</p>
        <div className="mt-6 flex items-end justify-between"><div><p className="text-sm text-slate-400">Queue token</p><p className="text-4xl font-black">#{entry.queue_number}</p></div><div className="text-right"><p className="text-sm text-slate-400">Estimated wait</p><p className="text-3xl font-black text-[#d9b78c]">{remaining ?? '--'} min</p></div></div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#d9b78c] transition-all duration-700" style={{ width: `${progress}%` }} /></div>
        <p className="mt-2 text-xs text-slate-400">Estimate updates as salon conditions change.</p>
      </div>
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-slate-400">Current status</p><p className="mt-1 text-xl font-black">{statusLabel(entry.status || entry.booking?.status)}</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">{entry.status}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-slate-400">Assigned barber</p><p className="font-semibold">{barber || 'To be assigned'}</p></div><div><p className="text-xs text-slate-400">Last updated</p><p className="font-semibold">{new Date(entry.created_at).toLocaleString('en-IN')}</p></div></div>
        <button type="button" onClick={async () => {
          if (window.Capacitor?.isNativePlatform?.()) {
            await initializeAndroidNotifications()
            return
          }
          const result = await registerWebDevice(userId)
          if (result.granted) {
            showQueueNotification('BOOKSALOON queue updates enabled', 'You will receive meaningful queue updates.', { bookingId })
          }
        }} className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold"><Bell size={16} /> Enable notifications</button>
        {window.Capacitor?.isNativePlatform?.() && entry.status === 'WAITING' && <button type="button" onClick={() => publishQueueNotification({ title: 'BOOKSALOON queue', body: `${remaining ?? 0} minutes estimated wait`, bookingId, progress })} className="ml-2 mt-5 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold">Update Android progress</button>}
      </div>
    </section>
  )
}
