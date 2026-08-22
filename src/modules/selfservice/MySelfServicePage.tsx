// docs/14-M9-EMPLOYEE-SELF-SERVICE.md §1 — own hours, roster,
// certifications, entitlement status, and flagging a time entry.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc, onSnapshot, orderBy, query, limit, where } from 'firebase/firestore'
import { rosterAssignmentsCol, shiftInstancesCol, timeEntriesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useParam } from '@/lib/params'
import { formatTimeManila, toDateSafe } from '@/lib/format'
import { CERT_LEVELS, MODULE_F, isCertificationActive } from '@/lib/certification'
import { summarizeShifts } from '@/lib/hours'
import { useSelfIdentity, computeEligibility, useSelfServiceActions } from './actions'
import type { RosterAssignment, ShiftInstance, TimeEntry } from '@/lib/types'

const LEVEL_ORDER = [...CERT_LEVELS, MODULE_F]

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
}

export function MySelfServicePage() {
  const activeBranch = useActiveBranch()
  const { identity, loading } = useSelfIdentity()
  const { flagDispute } = useSelfServiceActions()
  const nightStartParam = useParam('staff.night_diff_start')
  const nightEndParam = useParam('staff.night_diff_end')
  const leaveEligibilityParam = useParam('staff.leave_eligibility_months')
  const silEligibilityParam = useParam('staff.statutory_sil_eligibility_months')

  const [entries, setEntries] = useState<(TimeEntry & { id: string })[]>([])
  const [assignments, setAssignments] = useState<(RosterAssignment & { id: string })[]>([])
  const [shiftInstances, setShiftInstances] = useState<Map<string, ShiftInstance>>(new Map())
  const [flagging, setFlagging] = useState<string | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeBranch || !identity) return
    const q = query(
      timeEntriesCol,
      where('branchId', '==', activeBranch.branchId),
      where('userId', '==', identity.id),
      orderBy('at', 'desc'),
      limit(20),
    )
    return onSnapshot(q, (snap) => setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, identity?.id])

  useEffect(() => {
    if (!activeBranch || !identity) return
    const q = query(
      rosterAssignmentsCol,
      where('branchId', '==', activeBranch.branchId),
      where('userId', '==', identity.id),
      where('status', 'in', ['planned', 'confirmed']),
    )
    return onSnapshot(q, (snap) => setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, identity?.id])

  useEffect(() => {
    const ids = [...new Set(assignments.map((a) => a.shiftInstanceId))]
    if (ids.length === 0) return
    Promise.all(ids.map(async (id) => [id, (await getDoc(doc(shiftInstancesCol, id))).data()] as const)).then((pairs) => {
      const map = new Map<string, ShiftInstance>()
      for (const [id, data] of pairs) if (data) map.set(id, data)
      setShiftInstances(map)
    })
  }, [assignments])

  async function submitFlag(entryId: string) {
    if (!identity || !flagReason.trim()) return
    setBusy(true)
    setError(null)
    try {
      await flagDispute({ selfUserId: identity.id, selfUserName: identity.user.displayName, timeEntryId: entryId, reason: flagReason.trim() })
      setFlagging(null)
      setFlagReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not flag this entry.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p>Loading…</p>
  if (!identity) {
    return (
      <div className="card">
        <p>This account isn't linked to a staff record yet — ask the owner to link it (see RUNBOOK.md).</p>
      </div>
    )
  }

  const nightStart = nightStartParam.isSet ? String(nightStartParam.value) : '22:00'
  const nightEnd = nightEndParam.isSet ? String(nightEndParam.value) : '06:00'
  const summaries = summarizeShifts(entries, nightStart, nightEnd)

  const now = new Date()
  const hiredAt = toDateSafe(identity.user.hiredAt)
  const companyLeaveMonths = leaveEligibilityParam.isSet && typeof leaveEligibilityParam.value === 'number' ? leaveEligibilityParam.value : null
  const silMonths = silEligibilityParam.isSet && typeof silEligibilityParam.value === 'number' ? silEligibilityParam.value : null
  const companyEligibility = computeEligibility(hiredAt, companyLeaveMonths, now)
  const silEligibility = computeEligibility(hiredAt, silMonths, now)

  return (
    <div className="self-service-page">
      <h2>My self-service — {identity.user.displayName}</h2>

      <section className="card">
        <h2>Leave entitlement</h2>
        <p>
          Company leave:{' '}
          {companyEligibility.monthsSetting === null
            ? 'not set'
            : companyEligibility.eligible
              ? `eligible since ${companyEligibility.eligibleFrom!.toLocaleDateString()}`
              : `not yet eligible — from ${companyEligibility.eligibleFrom!.toLocaleDateString()}`}
        </p>
        <p>
          Statutory SIL:{' '}
          {silEligibility.monthsSetting === null
            ? 'not set'
            : silEligibility.eligible
              ? `eligible since ${silEligibility.eligibleFrom!.toLocaleDateString()}`
              : `not yet eligible — from ${silEligibility.eligibleFrom!.toLocaleDateString()}`}
        </p>
        <p>
          <Link to="/self/leave">Request leave / my requests</Link>
        </p>
      </section>

      <section className="card">
        <h2>Certifications</h2>
        <ul>
          {LEVEL_ORDER.map((l) => {
            const cert = identity.user.certifications?.[l]
            const active = isCertificationActive(cert, now)
            return (
              <li key={l}>
                {l === MODULE_F ? 'Module F' : l}: {!cert ? '—' : active ? 'active' : 'expired'}
              </li>
            )
          })}
        </ul>
      </section>

      {assignments.length > 0 && (
        <section className="card">
          <h2>Upcoming roster</h2>
          <ul>
            {assignments.map((a) => {
              const si = shiftInstances.get(a.shiftInstanceId)
              return (
                <li key={a.id}>
                  {a.role} — {si ? `${formatTimeManila(si.plannedStart)}–${formatTimeManila(si.plannedEnd)}` : 'loading…'}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Recent hours</h2>
        {summaries.length === 0 && <p className="empty-state">No clock events yet.</p>}
        {summaries.map((s, i) => (
          <div key={i} className="card">
            <p>
              {formatTimeManila(s.clockInterval.start)} – {formatTimeManila(s.clockInterval.end)}
            </p>
            <dl>
              <dt>Worked</dt>
              <dd>{fmtMinutes(s.totalMinutes)}</dd>
              <dt>Night differential</dt>
              <dd>{fmtMinutes(s.nightDifferentialMinutes)}</dd>
            </dl>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Clock events — flag one if it looks wrong</h2>
        {error && <p className="dialog__error">{error}</p>}
        <ul>
          {entries.map((e) => (
            <li key={e.id}>
              {e.type.replace('_', ' ')} — {formatTimeManila(e.at)}
              {flagging === e.id ? (
                <>
                  <input value={flagReason} onChange={(ev) => setFlagReason(ev.target.value)} placeholder="What looks wrong?" />
                  <button type="button" onClick={() => submitFlag(e.id)} disabled={busy || !flagReason.trim()}>
                    Submit
                  </button>
                  <button type="button" onClick={() => setFlagging(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setFlagging(e.id)}>
                  Flag
                </button>
              )}
            </li>
          ))}
        </ul>
        <p>
          <Link to="/self/disputes">My flagged entries</Link>
        </p>
      </section>
    </div>
  )
}
