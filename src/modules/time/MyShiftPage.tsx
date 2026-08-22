// Actual vs rostered, night-differential broken out separately
// (docs/08-M3-TIME-ROSTER-CERTIFICATION.md §2).
import { useEffect, useState } from 'react'
import { doc, getDoc, onSnapshot, query, where } from 'firebase/firestore'
import { rosterAssignmentsCol, shiftInstancesCol, timeEntriesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import { useParam } from '@/lib/params'
import { summarizeShifts } from '@/lib/hours'
import { formatTimeManila } from '@/lib/format'
import type { RosterAssignment, ShiftInstance, TimeEntry } from '@/lib/types'

function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m}m`
}

export function MyShiftPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const { actor } = usePinSession()
  const auth = useAuth()
  const nightStartParam = useParam('staff.night_diff_start')
  const nightEndParam = useParam('staff.night_diff_end')

  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [assignments, setAssignments] = useState<(RosterAssignment & { id: string })[]>([])
  const [shiftInstances, setShiftInstances] = useState<Map<string, ShiftInstance>>(new Map())

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

  useEffect(() => {
    if (!activeBranch || !businessDayId || !currentUserId) return
    const q = query(
      rosterAssignmentsCol,
      where('branchId', '==', activeBranch.branchId),
      where('businessDayId', '==', businessDayId),
      where('userId', '==', currentUserId),
    )
    return onSnapshot(q, (snap) => setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId, currentUserId])

  useEffect(() => {
    const ids = assignments.map((a) => a.shiftInstanceId)
    if (ids.length === 0) return
    Promise.all(
      ids.map(async (id) => {
        const snap = await getDoc(doc(shiftInstancesCol, id))
        return [id, snap.data()] as const
      }),
    ).then((pairs) => {
      const map = new Map<string, ShiftInstance>()
      for (const [id, data] of pairs) if (data) map.set(id, data)
      setShiftInstances(map)
    })
  }, [assignments])

  if (!currentUserId) {
    return (
      <div className="card">
        <p>Sign in to see your shift.</p>
      </div>
    )
  }

  const nightStart = nightStartParam.isSet ? String(nightStartParam.value) : '22:00'
  const nightEnd = nightEndParam.isSet ? String(nightEndParam.value) : '06:00'
  const summaries = summarizeShifts(entries, nightStart, nightEnd)

  return (
    <div className="my-shift-page">
      <h2>My shift — {currentUserName}</h2>

      {assignments.length > 0 && (
        <section className="card">
          <h2>Rostered</h2>
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
        <h2>Actual</h2>
        {summaries.length === 0 && <p className="empty-state">No clock events today yet.</p>}
        {summaries.map((s, i) => (
          <div key={i} className="card">
            <p>
              {formatTimeManila(s.clockInterval.start)} – {formatTimeManila(s.clockInterval.end)}
            </p>
            <dl>
              <dt>Worked</dt>
              <dd>{fmtMinutes(s.totalMinutes)}</dd>
              <dt>Break</dt>
              <dd>{fmtMinutes(s.breakMinutes)}</dd>
              <dt>Night differential</dt>
              <dd>{fmtMinutes(s.nightDifferentialMinutes)}</dd>
              <dt>Regular</dt>
              <dd>{fmtMinutes(s.regularMinutes)}</dd>
            </dl>
          </div>
        ))}
      </section>
    </div>
  )
}
