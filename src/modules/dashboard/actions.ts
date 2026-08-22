// docs/13-M8-DASHBOARD-DIGEST.md — live tile data (small, cheap, current-
// state queries, same shape M4-M6 already run) plus the closeBusinessDay
// callable wrapper. The live tiles never read dailySummaries — that
// collection only exists for the frozen historical digest.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import {
  cashCloseCountsCol,
  cashSessionsCol,
  checklistRunsCol,
  excursionsCol,
  exceptionsCol,
  functions,
  rosterAssignmentsCol,
  shiftInstancesCol,
  shiftTemplatesCol,
  usersCol,
} from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { useParam } from '@/lib/params'
import { toMillisSafe } from '@/lib/format'
import type {
  CashCloseCount,
  ChecklistRun,
  ExceptionRecord,
  Excursion,
  RosterAssignment,
  ShiftInstance,
  ShiftTemplate,
  User,
} from '@/lib/types'

export type DashboardData = {
  openExceptionsBySeverity: Record<ExceptionRecord['severity'], number>
  missedChecksToday: number
  cashSessionsOpen: number
  cashPendingAttention: number
  excursionsOpen: (Excursion & { id: string })[]
  shiftsPlanned: number
  shiftsShort: number
  certExpiryWindowSet: boolean
  certificationsExpiring: number
}

const EMPTY: DashboardData = {
  openExceptionsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
  missedChecksToday: 0,
  cashSessionsOpen: 0,
  cashPendingAttention: 0,
  excursionsOpen: [],
  shiftsPlanned: 0,
  shiftsShort: 0,
  certExpiryWindowSet: false,
  certificationsExpiring: 0,
}

export function useDashboardData(): DashboardData {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const certWarningParam = useParam('staff.certification_expiry_warning_days')

  const [exceptions, setExceptions] = useState<(ExceptionRecord & { id: string })[]>([])
  const [checklistRuns, setChecklistRuns] = useState<(ChecklistRun & { id: string })[]>([])
  const [cashSessionsOpen, setCashSessionsOpen] = useState<number>(0)
  const [cashCounts, setCashCounts] = useState<(CashCloseCount & { id: string })[]>([])
  const [excursionsOpen, setExcursionsOpen] = useState<(Excursion & { id: string })[]>([])
  const [shiftInstances, setShiftInstances] = useState<(ShiftInstance & { id: string })[]>([])
  const [shiftTemplates, setShiftTemplates] = useState<(ShiftTemplate & { id: string })[]>([])
  const [roster, setRoster] = useState<(RosterAssignment & { id: string })[]>([])
  const [users, setUsers] = useState<(User & { id: string })[]>([])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(
      exceptionsCol,
      where('branchId', '==', activeBranch.branchId),
      where('status', 'in', ['open', 'in_progress', 'escalated']),
    )
    return onSnapshot(q, (snap) => setExceptions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(checklistRunsCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setChecklistRuns(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(cashSessionsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'open'))
    return onSnapshot(q, (snap) => setCashSessionsOpen(snap.size))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(cashCloseCountsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setCashCounts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(excursionsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'open'))
    return onSnapshot(q, (snap) => setExcursionsOpen(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(shiftInstancesCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setShiftInstances(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(shiftTemplatesCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setShiftTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(rosterAssignmentsCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))
    return onSnapshot(q, (snap) => setRoster(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(usersCol, where('branchIds', 'array-contains', activeBranch.branchId), where('status', '==', 'active'))
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  if (!activeBranch) return EMPTY

  const openExceptionsBySeverity: DashboardData['openExceptionsBySeverity'] = { low: 0, medium: 0, high: 0, critical: 0 }
  exceptions.forEach((e) => {
    openExceptionsBySeverity[e.severity]++
  })

  const missedChecksToday = checklistRuns.filter((r) => r.status === 'missed').length

  // Same two "needs a human" states M4/M6's pending-reveals lists already surface.
  const cashPendingAttention = cashCounts.filter(
    (c) => c.status === 'counted' || (c.status === 'revealed' && c.requiresInvestigation && !c.investigationNote),
  ).length

  const templateById = new Map(shiftTemplates.map((t) => [t.id, t]))
  const rosterCountByShift = new Map<string, number>()
  roster.forEach((r) => {
    if (r.status === 'cancelled') return
    rosterCountByShift.set(r.shiftInstanceId, (rosterCountByShift.get(r.shiftInstanceId) ?? 0) + 1)
  })
  const shiftsShort = shiftInstances.filter((s) => {
    const min = templateById.get(s.templateId)?.targetHeadcount.min ?? 0
    return (rosterCountByShift.get(s.id) ?? 0) < min
  }).length

  const certExpiryWindowSet = certWarningParam.isSet && typeof certWarningParam.value === 'number'
  let certificationsExpiring = 0
  if (certExpiryWindowSet) {
    const days = certWarningParam.value as number
    const cutoffMs = Date.now() + days * 24 * 60 * 60 * 1000
    certificationsExpiring = users.filter((u) =>
      Object.values(u.certifications ?? {}).some((c) => {
        if (!c.expiresAt) return false
        const ms = toMillisSafe(c.expiresAt)
        return ms > Date.now() && ms <= cutoffMs
      }),
    ).length
  }

  return {
    openExceptionsBySeverity,
    missedChecksToday,
    cashSessionsOpen,
    cashPendingAttention,
    excursionsOpen,
    shiftsPlanned: shiftInstances.length,
    shiftsShort,
    certExpiryWindowSet,
    certificationsExpiring,
  }
}

/** Manager-only, enforced server-side — a station or crew account calling
 *  this gets permission-denied from the function itself, not just a hidden
 *  UI button (docs/13-M8-DASHBOARD-DIGEST.md). */
export async function closeBusinessDay(branchId: string, businessDayId: string): Promise<{ ok: boolean; dailySummaryId: string }> {
  const call = httpsCallable<{ branchId: string; businessDayId: string }, { ok: boolean; dailySummaryId: string }>(
    functions,
    'closeBusinessDay',
  )
  const result = await call({ branchId, businessDayId })
  return result.data
}
