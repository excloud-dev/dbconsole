/**
 * Service Worker for DBConsole Web App Updates
 *
 * This worker is intentionally conservative:
 * - It does NOT blanket-cache navigations or Next.js pages (high risk of serving stale HTML).
 * - It supports update checking via /api/app-info and notifies clients when a new version is available.
 * - It supports cache clearing on demand.
 */

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000 // 30 minutes

self.addEventListener('install', (event) => {
  console.log('[SW] Installing')
  event.waitUntil(self.skipWaiting())
})

let updateCheckTimer = null

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating')
  event.waitUntil((async () => {
    await self.clients.claim()
    startUpdateChecking()
  })())
})

self.addEventListener('message', (event) => {
  const { type } = event.data || {}

  switch (type) {
    case 'CHECK_FOR_UPDATES':
      checkForUpdates()
        .then((updateInfo) => {
          event.ports?.[0]?.postMessage({
            type: 'UPDATE_CHECK_RESULT',
            payload: updateInfo
          })
        })
        .catch((error) => {
          event.ports?.[0]?.postMessage({
            type: 'UPDATE_CHECK_ERROR',
            payload: { error: error && error.message ? error.message : String(error) }
          })
        })
      break

    case 'SKIP_WAITING':
      self.skipWaiting()
      break

    case 'CLEAR_CACHE':
      clearCache()
        .then(() => {
          event.ports?.[0]?.postMessage({ type: 'CACHE_CLEARED' })
        })
        .catch(() => {
          event.ports?.[0]?.postMessage({ type: 'CACHE_CLEARED' })
        })
      break

    default:
      // ignore
      break
  }
})

function startUpdateChecking() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
  }

  // Best-effort: SWs may be terminated when idle.
  updateCheckTimer = setInterval(() => {
    checkForUpdatesInBackground()
  }, UPDATE_CHECK_INTERVAL)
}

async function checkForUpdatesInBackground() {
  try {
    const updateInfo = await checkForUpdates()
    if (updateInfo && updateInfo.available) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true })
      clients.forEach((client) => {
        client.postMessage({
          type: 'UPDATE_AVAILABLE',
          payload: updateInfo
        })
      })
    }
  } catch (error) {
    console.warn('[SW] Background update check failed:', error)
  }
}

async function checkForUpdates() {
  const response = await fetch('/api/app-info', {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch app info: ${response.status}`)
  }
  const appInfo = await response.json()
  return appInfo.updateInfo || null
}

async function clearCache() {
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames.map((name) => caches.delete(name))
  )
  console.log('[SW] Cache cleared')
}

console.log('[SW] Loaded')