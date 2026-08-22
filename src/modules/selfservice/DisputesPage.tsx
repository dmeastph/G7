// docs/14-M9-EMPLOYEE-SELF-SERVICE.md §3, §5 — one route, two views: an
// employee sees their own flagged entries read-only; a manager sees every
// open dispute branch-wide with the resolve (correction) action.
import { useEffect, useState } from 'react'
import { doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { timeEntriesCol, timeEntryDisputesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { formatTimeManila } from '@/lib/format'
import { useSelfIdentity, useSelfServiceActions } from './actions'
import type { TimeEntry, TimeEntryDispute } from '@/lib/types'

type Row = TimeEntryDispute & { id: string }

function ResolveDisputeForm({ dispute, onDone }: { dispute: Row; onDone: () => void }) {
  const { actor } = usePinSession()
  const auth = useAuth()
  const { resolveDispute } = useSelfServiceActions()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [original, setOriginal] = useState<TimeEntry | null>(null)
  const [correctedAt, setCorrectedAt] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDoc(doc(timeEntriesCol, dispute.timeEntryId)).then((snap) => {
      const data = snap.data() ?? null
      setOriginal(data)
      if (data) {
        const d = data.at.toDate()
        const pad = (n: number) => String(n).padStart(2, '0')
        setCorrectedAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
      }
    })
  }, [dispute.timeEntryId])

  async function submit() {
    if (!who || !original || !correctedAt || !reason.trim()) {
      setError('A corrected time and a reason are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await resolveDispute(
        dispute,
        { userId: original.userId, userName: original.userName, type: original.type, at: new Date(correctedAt), photoRef: original.photoRef },
        reason.trim(),
        who.userId,
        who.userName,
      )
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve this dispute.')
    } finally {
      setBusy(false)
    }
  }

  if (!original) return <p>Loading original entry…</p>

  return (
    <div className="card">
      <p>
        Original: {original.type.replace('_', ' ')} — {formatTimeManila(original.at)}
      </p>
      <label>
        Corrected time
        <input type="datetime-local" value={correctedAt} onChange={(e) => setCorrectedAt(e.target.value)} />
      </label>
      <label>
        Correction reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="dialog__error">{error}</p>}
      <button type="button" onClick={submit} disabled={busy}>
        {busy ? 'Resolving…' : 'Resolve with correction'}
      </button>
    </div>
  )
}

export function DisputesPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { identity } = useSelfIdentity()
  const [rows, setRows] = useState<Row[]>([])
  const [resolving, setResolving] = useState<string | null>(null)

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  useEffect(() => {
    if (!activeBranch) return
    const q = isManager
      ? query(timeEntryDisputesCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'open'))
      : identity
        ? query(timeEntryDisputesCol, where('branchId', '==', activeBranch.branchId), where('userId', '==', identity.id))
        : null
    if (!q) return
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, isManager, identity?.id])

  return (
    <div className="disputes-page">
      <h2>{isManager ? 'Dispute inbox' : 'My flagged entries'}</h2>
      {rows.length === 0 && <p className="empty-state">Nothing here.</p>}
      {rows.map((r) => (
        <section className="card" key={r.id}>
          <p>
            {r.userName} — {r.reason} — {r.status}
          </p>
          {isManager && r.status === 'open' && resolving !== r.id && (
            <button type="button" onClick={() => setResolving(r.id)}>
              Resolve
            </button>
          )}
          {isManager && resolving === r.id && <ResolveDisputeForm dispute={r} onDone={() => setResolving(null)} />}
        </section>
      ))}
    </div>
  )
}
