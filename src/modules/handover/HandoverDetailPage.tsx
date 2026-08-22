// docs/11-M6-SHIFT-HANDOVER.md §2 — the frozen pack, and acceptance.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { shiftHandoversCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { formatTimeManila } from '@/lib/format'
import { useHandoverActions } from './actions'
import type { ShiftHandover } from '@/lib/types'

export function HandoverDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { acceptHandover } = useHandoverActions()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [handover, setHandover] = useState<(ShiftHandover & { id: string }) | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(shiftHandoversCol, id), (snap) => {
      const data = snap.data()
      setHandover(data ? { id, ...data } : null)
    })
  }, [id])

  async function handleAccept() {
    if (!id || !who) return
    setBusy(true)
    setError(null)
    try {
      await acceptHandover(id, note.trim(), who.userId, who.userName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept this handover.')
    } finally {
      setBusy(false)
    }
  }

  if (!handover) return <p>Loading…</p>

  const { pack } = handover

  return (
    <div className="handover-detail-page">
      <h2>Handover — {formatTimeManila(handover.createdAt)}</h2>
      <p>Generated {formatTimeManila(pack.generatedAt)}</p>

      <section className="card">
        <h2>Open exceptions ({pack.openExceptions.length})</h2>
        {pack.openExceptions.length === 0 && <p className="empty-state">Nothing open.</p>}
        <ul>
          {pack.openExceptions.map((item) => (
            <li key={item.exceptionId}>
              {item.title} — {item.severity} — {item.source}
              {item.carriedShiftCount >= 3 && <span className="dialog__warning"> — carried 3 shifts, escalated</span>}
              {item.carriedShiftCount > 1 && item.carriedShiftCount < 3 && <span> — carried {item.carriedShiftCount} shifts</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Other counts</h2>
        <p>Open incidents: {pack.openIncidentCount}</p>
        <p>Open maintenance tickets: {pack.openTicketCount}</p>
        <p className={pack.cashSessionsStillOpen > 0 ? 'dialog__warning' : undefined}>
          Cash sessions still open: {pack.cashSessionsStillOpen}
        </p>
        <p>Checklists completed today: {pack.checklistsCompletedToday}</p>
        <p>Checklists missed today: {pack.checklistsMissedToday}</p>
      </section>

      {handover.status === 'pending' ? (
        <section className="card">
          <h2>Accept</h2>
          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="dialog__error">{error}</p>}
          <button type="button" onClick={handleAccept} disabled={busy}>
            {busy ? 'Accepting…' : 'Accept handover'}
          </button>
        </section>
      ) : (
        <section className="card">
          <h2>Accepted</h2>
          <p>
            By {handover.acceptedByName} at {formatTimeManila(handover.acceptedAt)}
          </p>
          {handover.incomingNote && <p>Note: {handover.incomingNote}</p>}
        </section>
      )}
    </div>
  )
}
