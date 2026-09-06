// docs/18-M13-PURCHASE-REQUESTS.md §2 — pending requests branch-wide,
// approve or deny, a note required to deny (same as LeaveApprovalsPage).
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { purchaseRequestsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { decidePurchaseRequest } from '@/lib/purchaseRequests'
import type { PurchaseRequest } from '@/lib/types'

type Row = PurchaseRequest & { id: string }

export function PurchaseRequestApprovalsPage() {
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()

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
    const q = query(purchaseRequestsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'pending'))
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
      await decidePurchaseRequest(id, decision, who.userId, who.userName, (notes[id] ?? '').trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this decision.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="purchase-request-approvals-page">
      <h2>Purchase request approvals</h2>
      {error && <p className="dialog__error">{error}</p>}
      {rows.length === 0 && <p className="empty-state">No pending requests.</p>}
      {rows.map((r) => (
        <section className="card" key={r.id}>
          <h2>{r.userName}</h2>
          <p>Needed by {r.neededBy}{r.note && ` — ${r.note}`}</p>
          <ul>
            {r.lines.map((l, i) => (
              <li key={i}>
                {l.qty} {l.unit} {l.itemName}
              </li>
            ))}
          </ul>
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
