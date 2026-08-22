// docs/14-M9-EMPLOYEE-SELF-SERVICE.md §2-3 — request leave (coverage
// snapshot computed once, at submission) and the requester's own history.
import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { leaveRequestsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useSelfIdentity, useSelfServiceActions } from './actions'
import type { LeaveRequest, LeaveType } from '@/lib/types'

type Row = LeaveRequest & { id: string }

export function MyLeaveRequestsPage() {
  const activeBranch = useActiveBranch()
  const { identity } = useSelfIdentity()
  const { requestLeave } = useSelfServiceActions()

  const [rows, setRows] = useState<Row[]>([])
  const [type, setType] = useState<LeaveType>('company')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch || !identity) return
    const q = query(
      leaveRequestsCol,
      where('branchId', '==', activeBranch.branchId),
      where('userId', '==', identity.id),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, identity?.id])

  async function submit() {
    if (!identity) return
    if (!startDate || !endDate || !reason.trim()) {
      setError('Start date, end date and a reason are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await requestLeave({ selfUserId: identity.id, selfUserName: identity.user.displayName, type, startDate, endDate, reason: reason.trim() })
      setStartDate('')
      setEndDate('')
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit this request.')
    } finally {
      setBusy(false)
    }
  }

  if (!identity) return <p>This account isn't linked to a staff record yet.</p>

  return (
    <div className="leave-requests-page">
      <h2>Leave</h2>
      <section className="card">
        <h2>Request leave</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            <option value="company">Company leave</option>
            <option value="statutory_sil">Statutory SIL</option>
          </select>
        </label>
        <label>
          Start date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          End date
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Request leave'}
        </button>
      </section>

      <section className="card">
        <h2>My requests</h2>
        {rows.length === 0 && <p className="empty-state">No requests yet.</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              {r.type === 'company' ? 'Company leave' : 'Statutory SIL'} — {r.startDate} to {r.endDate} — {r.status}
              {r.coverageSnapshot.some((c) => c.wouldBeShort) && ' — would leave a shift short-staffed'}
              {r.status !== 'pending' && r.decisionNote && ` — ${r.decisionNote}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}