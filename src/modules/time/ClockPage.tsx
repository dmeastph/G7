// One tap from home, same urgency as M1's readings screen
// (docs/08-M3-TIME-ROSTER-CERTIFICATION.md §1).
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { timeEntriesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import { useTimeActions } from './actions'
import { toMillisSafe } from '@/lib/format'
import type { TimeEntry } from '@/lib/types'

type Status = 'clocked_out' | 'clocked_in' | 'on_break'

function currentStatus(entries: TimeEntry[]): Status {
  const sorted = [...entries].sort((a, b) => toMillisSafe(a.at) - toMillisSafe(b.at))
  let status: Status = 'clocked_out'
  for (const e of sorted) {
    if (e.type === 'clock_in') status = 'clocked_in'
    else if (e.type === 'clock_out') status = 'clocked_out'
    else if (e.type === 'break_start') status = 'on_break'
    else if (e.type === 'break_end') status = 'clocked_in'
  }
  return status
}

export function ClockPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { clockIn, clockOut, startBreak, endBreak } = useTimeActions()

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentUserId = actor?.userId ?? (auth.mode === 'managed' ? auth.user.uid : null)
  const currentUserName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : null)

  useEffect(() => {
    if (!activeBranch || !businessDayId || !currentUserId) return
    const q = query(
      timeEntriesCol,
      where('branchId', '==', activeBranch.branchId),
      where('businessDayId', '==', businessDayId),
      where('userId', '==', currentUserId),
    )
    return onSnapshot(q, (snap) => setEntries(snap.docs.map((d) => d.data())))
  }, [activeBranch, businessDayId, currentUserId])

  if (!currentUserId || !currentUserName) {
    return (
      <div className="card">
        <p>Sign in to clock in or out.</p>
      </div>
    )
  }

  const status = currentStatus(entries)

  async function withPhoto(action: (photo: Blob) => Promise<string>) {
    if (!photo) {
      setError('Take a photo first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await action(photo)
      setPhoto(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this.')
    } finally {
      setBusy(false)
    }
  }

  async function withoutPhoto(action: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clock-page">
      <h2>Clock — {currentUserName}</h2>
      <p className="dialog__hint">Status: {status.replace('_', ' ')}</p>
      {error && <p className="dialog__error">{error}</p>}

      {(status === 'clocked_out' || status === 'clocked_in') && (
        <section className="card">
          <label className="dialog__photo">
            Photo (required)
            <input type="file" accept="image/*" capture="user" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            {photo && <span>Photo ready</span>}
          </label>
          {status === 'clocked_out' && (
            <button type="button" onClick={() => withPhoto(clockIn)} disabled={busy || !photo}>
              {busy ? 'Clocking in…' : 'Clock in'}
            </button>
          )}
          {status === 'clocked_in' && (
            <button type="button" onClick={() => withPhoto(clockOut)} disabled={busy || !photo}>
              {busy ? 'Clocking out…' : 'Clock out'}
            </button>
          )}
        </section>
      )}

      {status === 'clocked_in' && (
        <section className="card">
          <button type="button" onClick={() => withoutPhoto(startBreak)} disabled={busy}>
            Start break
          </button>
        </section>
      )}

      {status === 'on_break' && (
        <section className="card">
          <button type="button" onClick={() => withoutPhoto(endBreak)} disabled={busy}>
            End break
          </button>
        </section>
      )}
    </div>
  )
}
