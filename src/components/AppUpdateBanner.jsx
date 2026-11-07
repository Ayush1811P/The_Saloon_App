import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const PLAY_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000

export default function AppUpdateBanner() {
  const [webUpdate, setWebUpdate] = useState(null)
  const [nativeUpdateAvailable, setNativeUpdateAvailable] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const isNative = Boolean(globalThis.window?.Capacitor?.isNativePlatform?.())

  const checkForUpdates = useCallback(async () => {
    if (isNative) {
      const plugin = globalThis.window?.Capacitor?.Plugins?.QueueNotification
      if (!plugin?.checkAppUpdate) return
      try {
        const result = await plugin.checkAppUpdate()
        setNativeUpdateAvailable(Boolean(result?.available))
      } catch (checkError) {
        console.error('Unable to check for Android app updates:', checkError)
      }
      return
    }

    if (!('serviceWorker' in navigator)) return
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration?.waiting && navigator.serviceWorker.controller) {
        setWebUpdate(registration)
        return
      }
      if (registration) await registration.update()
    } catch (checkError) {
      console.error('Unable to check for website updates:', checkError)
    }
  }, [isNative])

  useEffect(() => {
    let active = true
    let registration
    let updateCheckTimer
    const onControllerChange = () => window.location.reload()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdates()
    }

    const markWaitingUpdate = (workerRegistration) => {
      if (active && workerRegistration.waiting && navigator.serviceWorker.controller) {
        setWebUpdate(workerRegistration)
      }
    }

    const listenForInstallingWorker = (workerRegistration) => {
      workerRegistration.addEventListener('updatefound', () => {
        const installingWorker = workerRegistration.installing
        if (!installingWorker) return
        installingWorker.addEventListener('statechange', () => markWaitingUpdate(workerRegistration))
      })
      markWaitingUpdate(workerRegistration)
    }

    const setupWebUpdateChecks = async () => {
      if (!('serviceWorker' in navigator)) return
      registration = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.ready
      if (!active || !registration) return
      listenForInstallingWorker(registration)
      await registration.update()
      updateCheckTimer = window.setInterval(() => {
        registration.update().catch((checkError) => {
          console.error('Unable to check for website updates:', checkError)
        })
      }, UPDATE_CHECK_INTERVAL_MS)
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true })
    }

    if (isNative) {
      checkForUpdates()
      updateCheckTimer = window.setInterval(checkForUpdates, PLAY_UPDATE_CHECK_INTERVAL_MS)
    } else {
      setupWebUpdateChecks().catch((checkError) => {
        console.error('Unable to check for website updates:', checkError)
      })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      window.clearInterval(updateCheckTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange)
    }
  }, [checkForUpdates, isNative])

  const installUpdate = async () => {
    setUpdating(true)
    setError('')
    try {
      if (isNative) {
        const plugin = globalThis.window?.Capacitor?.Plugins?.QueueNotification
        if (!plugin?.startAppUpdate) throw new Error('In-app updates are not available in this app version.')
        await plugin.startAppUpdate()
        return
      }

      const waitingWorker = webUpdate?.waiting
      if (!waitingWorker) throw new Error('The update is no longer available. Check again in a moment.')
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    } catch (updateError) {
      setError(updateError.message || 'Unable to start the update.')
      setUpdating(false)
    }
  }

  if (!nativeUpdateAvailable && !webUpdate) return null

  return (
    <div role="status" className="mb-4 flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-bold">A new BOOKSALOON update is ready</p>
        <p className="mt-1 text-sm">Update now to get the latest improvements.</p>
        {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      </div>
      <button
        type="button"
        onClick={installUpdate}
        disabled={updating}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-violet-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
      >
        {updating ? <RefreshCw size={16} className="animate-spin" /> : null}
        {updating ? 'Updating...' : 'Update app'}
      </button>
    </div>
  )
}
