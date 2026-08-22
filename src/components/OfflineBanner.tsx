// Staff must be able to see that their work is queued and not lost
// (docs/01-ARCHITECTURE.md — Offline rules).
import { useOnlineStatus, usePendingWriteCount } from '@/lib/offline'

export function OfflineBanner() {
  const online = useOnlineStatus()
  const pending = usePendingWriteCount()

  if (online && pending === 0) return null

  return (
    <div className={`offline-banner ${online ? 'offline-banner--syncing' : 'offline-banner--offline'}`} role="status">
      {online ? (
        <span>Syncing {pending} queued {pending === 1 ? 'write' : 'writes'}…</span>
      ) : (
        <span>Offline — {pending > 0 ? `${pending} ${pending === 1 ? 'write' : 'writes'} queued, will sync` : 'work is saved locally'}</span>
      )}
    </div>
  )
}
