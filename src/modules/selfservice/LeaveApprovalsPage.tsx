// docs/14-M9-EMPLOYEE-SELF-SERVICE.md §4 — pending requests branch-wide,
// the frozen coverage snapshot shown plainly, approve/deny.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { leaveRequestsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useSelfServiceActions } from './actions'
import type { LeaveRequest } from '@/lib/types'

type Row = LeaveRequest & { id: string }

export function LeaveApprovalsPage() {
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { decideLeave } = useSelfServiceActions()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [rows, setRows] = useState<Row[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(leaveRequestsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'pending'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function decide(id: string, decision: 'approved' | 'denied') {
    if (!who) return
    if (decision === 'denied' && !(notes[id] ?? '').trim()) {
      setError('A note is required to deny a request.')
      return
    }
    setBusy(id)
    setError(null)
    try {
      await decideLeave(id, decision, who.userId, who.userName, (notes[id] ?? '').trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this decision.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="leave-approvals-page">
      <h2>Leave approvals</h2>
      {error && <p className="dialog__error">{error}</p>}
      {rows.length === 0 && <p className="empty-state">No pending requests.</p>}
      {rows.map((r) => (
        <section className="card" key={r.id}>
          <h2>
            {r.userName} — {r.type === 'company' ? 'Company leave' : 'Statutory SIL'}
          </h2>
          <p>
            {r.startDate} to {r.endDate} — {r.reason}
          </p>
          {r.coverageSnapshot.length > 0 && (
            <ul>
              {r.coverageSnapshot.map((c) => (
                <li key={c.shiftInstanceId} className={c.wouldBeShort ? 'dialog__warning' : undefined}>
                  {c.date} — {c.templateName} — {c.assignedCount} assigned, needs {c.minRequired}
                  {c.wouldBeShort && ' — would go short'}
                </li>
              ))}
            </ul>
          )}
          <label>
            Note (required to deny)
            <input value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
          </label>
          <div className="dialog__actions">
            <button type="button" onClick={() => decide(r.id, 'approved')} disabled={busy === r.id}>
              Approve
            </button>
            <button type="button" onClick={() => decide(r.id, 'denied')} disabled={busy === r.id}>
              Deny
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
