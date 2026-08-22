// docs/11-M6-SHIFT-HANDOVER.md §1 — generate (or reuse) a handover for the
// current shift, list pending and recently-accepted ones for the branch.
import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { shiftHandoversCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { formatTimeManila, toMillisSafe } from '@/lib/format'
import { useHandoverActions } from './actions'
import type { ShiftHandover } from '@/lib/types'

type Row = ShiftHandover & { id: string }

export function HandoverListPage() {
  const activeBranch = useActiveBranch()
  const { generateHandover } = useHandoverActions()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(shiftHandoversCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function handleGenerate() {
    setBusy(true)
    setError(null)
    try {
      const id = await generateHandover()
      navigate(`/handover/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a handover.')
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))
  const pending = sorted.filter((r) => r.status === 'pending')
  const accepted = sorted.filter((r) => r.status === 'accepted')

  return (
    <div className="handover-page">
      <h2>Shift handover</h2>

      <section className="card">
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={handleGenerate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate handover'}
        </button>
      </section>

      <section className="card">
        <h2>Pending</h2>
        {pending.length === 0 && <p className="empty-state">No pending handovers.</p>}
        <ul>
          {pending.map((r) => (
            <li key={r.id}>
              <Link to={`/handover/${r.id}`}>{formatTimeManila(r.createdAt)} — {r.pack.openExceptions.length} open exceptions</Link>
            </li>
          ))}
        </ul>
      </section>

      {accepted.length > 0 && (
        <section className="card">
          <h2>Accepted</h2>
          <ul>
            {accepted.map((r) => (
              <li key={r.id}>
                <Link to={`/handover/${r.id}`}>
                  {formatTimeManila(r.createdAt)} — accepted by {r.acceptedByName}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
