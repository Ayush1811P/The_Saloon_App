import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, MapPin, WifiOff } from 'lucide-react'
import { getLiveQueueBooking, getProgressPercent, getRemainingMinutes, subscribeToQueueBooking } from '../../services/queueTrackerService'
import { combineLocationAddress, createGoogleMapsDirectionsUrl, reverseGeocodeLocation } from '../../services/addressSearch'
import { getAvailableRideApps, openRideApp } from '../../services/rideBooking'
import { supabase } from '../../lib/supabase'
import { registerWebDevice, requestWebNotifications } from '../../services/notificationService'
import {
  cancelLeaveReminderNotification,
  getLeaveReminderNotificationState,
  initializeAndroidNotifications,
  publishQueueNotification,
  requestAndroidNotificationPermission,
  requestLeaveReminderNotificationPermission,
  scheduleLeaveReminderNotification,
  showCurrentStatusNotification,
  showLeaveReminderNotification,
} from '../../services/platformNotificationAdapter'
import {
  SMART_LEAVE_CONFIG,
  clearTravelEstimate,
  createReminderPlan,
  createTravelEstimate,
  getLeaveReminderNotificationId,
  getOneTimeLocation,
  readTravelEstimate,
  reconcileSmartLeaveReminder,
  saveTravelEstimate,
} from '../../services/smartLeaveReminder'

function statusLabel(status) {
  return { WAITING: 'Waiting in queue', CALLED: 'Your turn is next', SERVING: 'Service in progress', COMPLETED: 'Service completed', CANCELLED: 'Appointment cancelled' }[status] || status
}

function formatTime(value) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export default function LiveQueueTracker({ bookingId, userId }) {
  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
  const [enablingNotifications, setEnablingNotifications] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [now, setNow] = useState(Date.now())
  const [travelEstimate, setTravelEstimate] = useState(() => readTravelEstimate(bookingId))
  const [userLocation, setUserLocation] = useState(null)
  const [userLocationAddress, setUserLocationAddress] = useState('')
  const [locatingUser, setLocatingUser] = useState(false)
  const [rideApps, setRideApps] = useState([])
  const [rideAppsOpen, setRideAppsOpen] = useState(false)
  const [rideAppsLoading, setRideAppsLoading] = useState(false)
  const [rideAppsError, setRideAppsError] = useState('')
  const [smartLeaveMessage, setSmartLeaveMessage] = useState('')
  const [smartLeaveStatus, setSmartLeaveStatus] = useState('')
  const smartLeaveWork = useRef(Promise.resolve())
  const autoLocationBooking = useRef('')

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
  const progress = entry ? getProgressPercent(entry, now) : 0
  const salonId = entry?.booking?.salon?.id
  const salonName = entry?.booking?.salon?.name
  const salonCity = entry?.booking?.salon?.city
  const salonAddress = entry?.booking?.salon?.address_line1
  const salonLocationDescription = entry?.booking?.salon?.location_description
  const salonLatitude = entry?.booking?.salon?.latitude
  const salonLongitude = entry?.booking?.salon?.longitude
  const salon = useMemo(() => salonId ? {
    id: salonId,
    name: salonName,
    city: salonCity,
    address_line1: salonAddress,
    location_description: salonLocationDescription,
    latitude: salonLatitude,
    longitude: salonLongitude,
  } : null, [salonId, salonName, salonCity, salonAddress, salonLocationDescription, salonLatitude, salonLongitude])
  const queueEntryStatus = entry?.status
  const bookingStatus = entry?.booking?.status
  const expectedStartAt = entry?.estimated_start_at
  const hasQueueEntry = Boolean(entry)
  const hasTravelEstimate = Boolean(travelEstimate)
  const travelMinutes = travelEstimate?.travelMinutes
  const service = entry?.booking?.booking_items?.map((item) => item.service_name_snapshot).join(', ')
  const barber = entry?.booking?.booking_staff?.[0]?.employee?.employee_name
  const journeyPlan = travelEstimate && entry?.estimated_start_at
    ? createReminderPlan(entry.estimated_start_at, travelEstimate.travelMinutes, now)
    : null
  const directionsUrl = createGoogleMapsDirectionsUrl(salon, userLocation)
  const locationAccessEnabled = globalThis.localStorage?.getItem(`booksaloon-location-enabled:${userId}`) === 'true'

  const captureCurrentLocation = useCallback(async () => {
    setLocatingUser(true)
    setSmartLeaveMessage('')
    try {
      if (!salon || salon.latitude == null || salon.longitude == null) {
        throw new Error('The salon address is not available yet.')
      }
      const position = await getOneTimeLocation({ isNative: Boolean(window.Capacitor?.isNativePlatform?.()) })
      const estimate = createTravelEstimate(position, salon, position.timestamp || Date.now())
      const saved = saveTravelEstimate(bookingId, estimate, salon)
      let locationAddress = ''
      let addressLookupWarning = ''
      try {
        locationAddress = await reverseGeocodeLocation(position)
      } catch (addressError) {
        addressLookupWarning = addressError.message || 'The precise area address could not be looked up.'
      }
      const locationAddressDetails = globalThis.localStorage?.getItem(`booksaloon-location-address:${userId}`) || ''
      const preciseLocationAddress = combineLocationAddress(locationAddressDetails, locationAddress)
      setUserLocation({ ...position, ...(preciseLocationAddress ? { address: preciseLocationAddress } : {}) })
      setTravelEstimate(saved)
      setUserLocationAddress(preciseLocationAddress)
      setSmartLeaveMessage(`Location found${preciseLocationAddress ? `: ${preciseLocationAddress}` : ''}. Your travel estimate is ready, and your coordinates stay on this device.${addressLookupWarning ? ` Address lookup warning: ${addressLookupWarning}` : ''}`)
    } catch (locationError) {
      setSmartLeaveMessage(locationError.message || 'Unable to get your current location. Check location permission and try again.')
    } finally {
      setLocatingUser(false)
    }
  }, [bookingId, salon, userId])

  const showRideApps = async () => {
    if (rideAppsOpen) {
      setRideAppsOpen(false)
      return
    }
    setRideAppsOpen(true)
    if (rideApps.length) return
    setRideAppsLoading(true)
    setRideAppsError('')
    try {
      setRideApps(await getAvailableRideApps({ native: Boolean(window.Capacitor?.isNativePlatform?.()) }))
    } catch (rideError) {
      setRideAppsError(rideError.message || 'Unable to load ride apps.')
    } finally {
      setRideAppsLoading(false)
    }
  }

  const chooseRideApp = async (app) => {
    setRideAppsError('')
    try {
      await openRideApp(app.id, {
        latitude: salon?.latitude,
        longitude: salon?.longitude,
        address: salon?.location_description || salon?.address_line1 || salon?.name,
      }, { native: Boolean(window.Capacitor?.isNativePlatform?.()) })
    } catch (rideError) {
      setRideAppsError(rideError.message || `Unable to open ${app.name}.`)
    }
  }

  useEffect(() => {
    setTravelEstimate(readTravelEstimate(bookingId))
    setSmartLeaveMessage('')
    setSmartLeaveStatus('')
    setUserLocation(null)
    autoLocationBooking.current = ''
  }, [bookingId])

  useEffect(() => {
    if (!locationAccessEnabled || !hasQueueEntry || !salon || hasTravelEstimate || autoLocationBooking.current === bookingId
        || !['WAITING', 'CALLED'].includes(queueEntryStatus)
        || ['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(bookingStatus)) return undefined

    autoLocationBooking.current = bookingId
    captureCurrentLocation()
    return undefined
  }, [bookingId, hasQueueEntry, salon, hasTravelEstimate, queueEntryStatus, bookingStatus, locationAccessEnabled, captureCurrentLocation])

  useEffect(() => {
      if (!hasQueueEntry || !['WAITING', 'CALLED'].includes(queueEntryStatus)
          || !hasTravelEstimate || !expectedStartAt) return undefined
    let active = true
    supabase.rpc('schedule_travel_reminder', {
      p_booking_id: bookingId,
        p_travel_minutes: travelMinutes,
    }).then(({ data, error: scheduleError }) => {
      if (!active) return
      if (scheduleError) {
        setSmartLeaveMessage(`Your travel estimate is ready, but the automatic push reminder could not be scheduled: ${scheduleError.message}`)
      } else if (data) {
        setSmartLeaveStatus('scheduled')
      }
    }).catch((scheduleError) => {
      if (active) setSmartLeaveMessage(`Your travel estimate is ready, but the automatic push reminder could not be scheduled: ${scheduleError.message}`)
    })
    return () => { active = false }
  }, [bookingId, hasQueueEntry, queueEntryStatus, expectedStartAt, hasTravelEstimate, travelMinutes])

  const disableSmartLeaveReminder = async () => {
    try {
      await cancelLeaveReminderNotification(getLeaveReminderNotificationId(bookingId))
      clearTravelEstimate(bookingId)
      setTravelEstimate(null)
      setSmartLeaveStatus('')
      setSmartLeaveMessage('Smart Leave Reminder disabled. The saved travel estimate was cleared.')
    } catch (disableError) {
      setSmartLeaveMessage(`Unable to cancel the pending notification: ${disableError.message}`)
    }
  }

  useEffect(() => {
    if (loading || error) return undefined
    let active = true
    const reconcile = async () => {
      const native = Boolean(window.Capacitor?.isNativePlatform?.())
      const notificationId = getLeaveReminderNotificationId(bookingId)
      if (!entry) {
        await cancelLeaveReminderNotification(notificationId)
        clearTravelEstimate(bookingId)
        if (active) {
          setTravelEstimate(null)
          setSmartLeaveStatus('')
        }
        return
      }
      const bookingStatus = String(entry.booking?.status || '').toUpperCase()
      const queueStatus = String(entry.status || '').toUpperCase()
      const currentStatus = ['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(bookingStatus)
        ? bookingStatus
        : queueStatus
      const result = await reconcileSmartLeaveReminder({
        bookingId,
        status: currentStatus,
        expectedStartAt: entry.estimated_start_at,
        now,
        native,
        notifications: {
          cancel: cancelLeaveReminderNotification,
          getState: getLeaveReminderNotificationState,
          schedule: scheduleLeaveReminderNotification,
          show: showLeaveReminderNotification,
        },
      })
      if (!active) return
      setTravelEstimate((current) => current?.savedAt === result.estimate?.savedAt
        && current?.reminderSentAt === result.estimate?.reminderSentAt
        ? current
        : result.estimate)
      setSmartLeaveStatus(result.status)
      if (result.status === 'cleared') {
        setSmartLeaveMessage(`The reminder was cleared because this booking is ${result.reason}.`)
      } else if (result.status === 'notification-unavailable') {
        setSmartLeaveMessage('Notification permission is unavailable. The leave reminder will still appear on this screen while it is open.')
      } else if (result.status === 'unavailable') {
        setSmartLeaveMessage('The queue estimate is unavailable. The reminder will update when a start time is available.')
      }
    }

    smartLeaveWork.current = smartLeaveWork.current
      .catch(() => {})
      .then(async () => {
        if (!active) return
        try {
          await reconcile()
        } catch (reconcileError) {
          if (active) {
            setSmartLeaveStatus('error')
            setSmartLeaveMessage(`Unable to update the leave reminder: ${reconcileError.message}`)
          }
        }
      })
    return () => { active = false }
  }, [bookingId, entry, error, loading, now, travelEstimate])

  const enableNotifications = async () => {
    setEnablingNotifications(true)
    setNotificationMessage('')
    let statusSent = false
    const bookingStatus = entry.booking?.status
    const currentStatus = entry.status || bookingStatus
    const waitMinutes = remaining ?? entry.estimated_wait_minutes
    const statusBody = currentStatus === 'CANCELLED' || bookingStatus === 'CANCELLED'
      ? 'Your appointment has been cancelled.'
      : currentStatus === 'CONFIRMED' || bookingStatus === 'CONFIRMED'
        ? `Your appointment is approved${barber ? ` and assigned to ${barber}` : ''}.`
        : currentStatus === 'WAITING' || bookingStatus === 'WAITING'
          ? `Your appointment is in the queue. ${waitMinutes ?? 'The wait time is being calculated'}${waitMinutes != null ? ' minutes remaining.' : '.'}`
          : statusLabel(currentStatus)

    try {
      if (window.Capacitor?.isNativePlatform?.()) {
        const permission = await requestAndroidNotificationPermission()
        if (!permission.supported) throw new Error('Notifications are not supported on this device.')
        if (!permission.granted) throw new Error('Allow notifications in Android settings to continue.')
        const leavePermission = await requestLeaveReminderNotificationPermission()
        await showCurrentStatusNotification({ title: 'BOOKSALOON appointment status', body: statusBody, bookingId })
        statusSent = true
        const result = await initializeAndroidNotifications()
        setNotificationMessage(result.supported
          ? `Current status notification sent. Future appointment updates are enabled.${leavePermission.granted ? ' Your automatic leave reminder is enabled.' : ' Allow local notifications to receive the leave reminder.'}`
          : `Current status notification sent. Future updates are unavailable: ${result.reason || 'push notifications are not configured on this app build.'}`)
        setNow(Date.now())
        return
      }

      const permission = await requestWebNotifications()
      if (!permission.supported) throw new Error('This browser does not support notifications.')
      if (!permission.granted) throw new Error('Notification permission was not granted.')
      const leavePermission = await requestLeaveReminderNotificationPermission()
      await showCurrentStatusNotification({ title: 'BOOKSALOON appointment status', body: statusBody, bookingId })
      statusSent = true
      const result = await registerWebDevice(userId)
      setNotificationMessage(result.pushSupported
        ? `Current status notification sent. Future appointment updates are enabled.${leavePermission.granted ? ' Your automatic leave reminder is enabled.' : ' Browser notifications are disabled for the leave reminder.'}`
        : 'Current status notification sent. Background push notifications are not supported in this browser.')
      setNow(Date.now())
    } catch (notificationError) {
      setNotificationMessage(statusSent
        ? `Current status notification sent, but future updates could not be enabled: ${notificationError.message || 'unknown error'}`
        : notificationError.message || 'Unable to enable appointment notifications.')
    } finally {
      setEnablingNotifications(false)
    }
  }

  useEffect(() => {
    if (!entry || entry.status !== 'WAITING' || !window.Capacitor?.isNativePlatform?.()) return
    publishQueueNotification({
      title: 'BOOKSALOON queue',
      body: `${remaining ?? 0} minutes estimated wait`,
      bookingId,
      progress,
      estimatedStartAt: entry.estimated_start_at,
      startedAt: entry.created_at,
    }).catch((notificationError) => {
      console.error('Unable to update Android queue progress:', notificationError)
    })
  }, [bookingId, entry, progress, remaining])

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
        {directionsUrl && <a href={directionsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-full bg-[#d9b78c] px-4 py-2 text-sm font-bold text-[#0b1220]">Open Google Maps directions</a>}
        <div className="mt-6 flex items-end justify-between"><div><p className="text-sm text-slate-400">Queue token</p><p className="text-4xl font-black">#{entry.queue_number}</p></div><div className="text-right"><p className="text-sm text-slate-400">Estimated wait</p><p className="text-3xl font-black text-[#d9b78c]">{remaining ?? '--'} min</p></div></div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#d9b78c] transition-all duration-700" style={{ width: `${progress}%` }} /></div>
        <p className="mt-2 text-xs text-slate-400">Estimate updates as salon conditions change.</p>
      </div>
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-slate-400">Current status</p><p className="mt-1 text-xl font-black">{statusLabel(entry.status || entry.booking?.status)}</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700">{entry.status}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-slate-400">Assigned barber</p><p className="font-semibold">{barber || 'To be assigned'}</p></div><div><p className="text-xs text-slate-400">Last updated</p><p className="font-semibold">{new Date(entry.created_at).toLocaleString('en-IN')}</p></div></div>
        <button type="button" onClick={enableNotifications} disabled={enablingNotifications} className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold disabled:opacity-50"><Bell size={16} /> {enablingNotifications ? 'Enabling...' : 'Enable notifications'}</button>
        {notificationMessage && <p role="status" className="mt-3 text-sm text-slate-600">{notificationMessage}</p>}
      </div>
      <div className="rounded-[24px] border border-[#d9b78c]/50 bg-[#0b1220] p-5 text-white shadow-lg sm:p-6">
        <div className="flex items-start gap-3">
          <span className="rounded-2xl bg-[#d9b78c]/15 p-3 text-[#d9b78c]"><MapPin size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#d9b78c]">Your Journey to The Saloon</p>
            <h2 className="mt-1 text-xl font-black">Smart Leave Reminder</h2>
            <p className="mt-2 text-sm text-slate-300">Allow The Saloon to estimate your journey and remind you when it's time to leave. Your location is captured once and only an approximate travel estimate is saved on this device.</p>
          </div>
        </div>
        {(!salon || salon.latitude == null || salon.longitude == null) ? (
          <p className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">Salon location has not been configured. Smart travel reminders are currently unavailable.</p>
        ) : (
          <>
            <p className="mt-4 text-sm font-semibold text-slate-100">{salon.location_description || salon.address_line1 || salon.name || 'Salon location saved'}</p>
            {userLocationAddress && <p className="mt-2 text-sm text-slate-300">Your current area: {userLocationAddress}</p>}
            <div className="mt-4 flex flex-wrap gap-3">
              {directionsUrl && <a href={directionsUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-full bg-[#d9b78c] px-4 py-2 text-sm font-bold text-[#0b1220]">Open Google Maps directions</a>}
              <button type="button" onClick={showRideApps} className="rounded-full border border-white/25 px-4 py-2 text-sm font-bold text-white hover:bg-white/10">
                {rideAppsOpen ? 'Hide ride apps' : 'Book a ride now'}
              </button>
            </div>
            {rideAppsOpen && (
              <div className="mt-3 rounded-2xl border border-white/15 bg-white/5 p-4">
                <p className="font-bold text-white">{window.Capacitor?.isNativePlatform?.() ? 'Ride apps installed on this device' : 'Ride services (installed apps will open if available)'}</p>
                {rideAppsLoading && <p className="mt-2 text-sm text-slate-300">Checking available ride apps...</p>}
                {!rideAppsLoading && rideApps.length === 0 && !rideAppsError && (
                  <p className="mt-2 text-sm text-slate-300">No supported ride apps were found. Use Google Maps directions instead.</p>
                )}
                {rideAppsError && <p role="alert" className="mt-2 text-sm text-rose-200">{rideAppsError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {rideApps.map((app) => <button key={app.id} type="button" onClick={() => chooseRideApp(app)} className="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900">{app.name}</button>)}
                </div>
              </div>
            )}
            {travelEstimate ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Approximate distance</p><p className="mt-1 text-lg font-bold">{travelEstimate.straightLineDistanceKm.toFixed(1)} km</p></div>
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Approximate bike travel time</p><p className="mt-1 text-lg font-bold">{travelEstimate.travelMinutes} min</p></div>
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Appointment expected</p><p className="mt-1 font-bold">{formatTime(entry.estimated_start_at)}</p></div>
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Time remaining</p><p className="mt-1 font-bold">{remaining == null ? 'Estimate unavailable' : `${remaining} min`}</p></div>
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Preparation buffer</p><p className="mt-1 font-bold">{SMART_LEAVE_CONFIG.preparationBufferMinutes} min</p></div>
                  <div className="rounded-2xl bg-white/5 p-4"><p className="text-xs text-slate-400">Leave by</p><p className="mt-1 font-bold text-[#d9b78c]">{journeyPlan?.due ? 'Leave now' : journeyPlan ? formatTime(journeyPlan.leaveAt) : 'Estimate unavailable'}</p></div>
                </div>
                <p className={`mt-4 rounded-2xl p-4 text-sm font-semibold ${journeyPlan?.due ? 'bg-[#d9b78c] text-[#0b1220]' : 'bg-white/5 text-slate-100'}`} role={journeyPlan?.due ? 'alert' : 'status'}>
                  {journeyPlan?.due
                    ? "It's time to leave now!"
                    : smartLeaveStatus === 'sent'
                      ? 'Your leave reminder has already been sent for this booking.'
                      : journeyPlan
                        ? smartLeaveStatus === 'scheduled'
                          ? 'Your leave reminder is scheduled.'
                          : 'Your leave reminder will follow the live queue estimate.'
                        : 'The queue estimate is unavailable. The reminder will update when a start time is available.'}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">Travel time is an estimate based on distance and average speed. Actual journey time may vary due to traffic and road conditions.</p>
                <p className="mt-2 text-xs text-slate-500">Location accuracy: ±{Math.round(travelEstimate.accuracyMeters)} m • Captured {new Date(travelEstimate.capturedAt).toLocaleString('en-IN')}</p>
                <button type="button" onClick={disableSmartLeaveReminder} className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Disable Smart Leave Reminder</button>
              </>
            ) : (
              <button type="button" onClick={captureCurrentLocation} disabled={locatingUser} className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#d9b78c] px-5 py-3 text-sm font-black text-[#0b1220] disabled:opacity-50">
                <MapPin size={16} /> {locatingUser ? 'Getting your location...' : 'Use my location for travel estimate'}
              </button>
            )}
          </>
        )}
        {smartLeaveMessage && <p role="status" className="mt-3 rounded-2xl bg-white/10 p-3 text-sm text-slate-200">{smartLeaveMessage}</p>}
      </div>
    </section>
  )
}
