// docs/08-M3-TIME-ROSTER-CERTIFICATION.md §3-4 — assignment grid plus the
// coverage view (target headcount + three cover tests) for today's
// business day.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore'
import { rosterAssignmentsCol, shiftInstancesCol, shiftTemplatesCol, usersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { computeCoverageTests } from '@/lib/certification'
import { formatTimeManila } from '@/lib/format'
import type { RosterAssignment, ShiftInstance, ShiftTemplate, User } from '@/lib/types'
import { AddAssignmentDialog } from './AddAssignmentDialog'

type SI = ShiftInstance & { id: string }
type Assignment = RosterAssignment & { id: string }

export function RosterBuilderPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const [shiftInstances, setShiftInstances] = useState<SI[]>([])
  const [templates, setTemplates] = useState<Map<string, ShiftTemplate>>(new Map())
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<(User & { id: string })[]>([])
  const [assigningTo, setAssigningTo] = useState<SI | null>(null)
  const [now] = useState(new Date())

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(shiftInstancesCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setShiftInstances(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(shiftTemplatesCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => {
      const map = new Map<string, ShiftTemplate>()
      snap.forEach((d) => map.set(d.id, d.data()))
      setTemplates(map)
    })
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(rosterAssignmentsCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(usersCol, where('branchIds', 'array-contains', activeBranch.branchId), where('status', '==', 'active'))
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const usersById = new Map(users.map((u) => [u.id, u]))

  async function cancelAssignment(id: string) {
    await updateDoc(doc(rosterAssignmentsCol, id), { status: 'cancelled' })
  }

  return (
    <div className="roster-page">
      <h2>Roster</h2>
      {shiftInstances.length === 0 && <p className="empty-state">No shifts for today's business day.</p>}

      {shiftInstances.map((si) => {
        const template = templates.get(si.templateId)
        const active = assignments.filter((a) => a.shiftInstanceId === si.id && a.status !== 'cancelled')
        const assignees = active
          .map((a) => usersById.get(a.userId))
          .filter((u): u is User & { id: string } => !!u)
          .map((u) => ({ role: active.find((a) => a.userId === u.id)!.role, certifications: u.certifications ?? {} }))
        const coverage = computeCoverageTests(assignees, now)

        return (
          <section className="card" key={si.id}>
            <h2>
              {si.templateName} — {formatTimeManila(si.plannedStart)}–{formatTimeManila(si.plannedEnd)}
            </h2>
            <p className="dialog__hint">
              Assigned {active.length}
              {template ? ` / target ${template.targetHeadcount.min}–${template.targetHeadcount.max}` : ''}
            </p>
            <ul>
              {active.map((a) => (
                <li key={a.id}>
                  {a.userName} — {a.role}{' '}
                  <button type="button" onClick={() => cancelAssignment(a.id)}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setAssigningTo(si)}>
              Add assignment
            </button>

            <div className="coverage-tests">
              <span className={coverage.l4Present ? 'coverage-pass' : 'coverage-fail'}>L4 present: {coverage.l4Present ? 'pass' : 'fail'}</span>
              <span className={coverage.l3OnDrawer ? 'coverage-pass' : 'coverage-fail'}>L3 on drawer: {coverage.l3OnDrawer ? 'pass' : 'fail'}</span>
              <span className={coverage.moduleFPresent ? 'coverage-pass' : 'coverage-fail'}>Module F present: {coverage.moduleFPresent ? 'pass' : 'fail'}</span>
            </div>
          </section>
        )
      })}

      {assigningTo && (
        <AddAssignmentDialog
          shiftInstance={assigningTo}
          shiftInstanceId={assigningTo.id}
          users={users}
          onClose={() => setAssigningTo(null)}
        />
      )}
    </div>
  )
}
