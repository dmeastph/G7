// docs/14-M9-EMPLOYEE-SELF-SERVICE.md — a personal login resolves its own
// users doc once (via authUid), then uses that id everywhere M9 needs "who
// is this," instead of the Firebase UID lib/write.ts's resolveActor()
// would otherwise fall back to. See the spec's "identity problem" section
// for why this is scoped to new M9 code, not a change to write.ts.
import { useEffect, useState } from 'react'
import { doc, getDoc, getDocs, onSnapshot, query, updateDoc, serverTimestamp, Timestamp, where } from 'firebase/firestore'
import {
  rosterAssignmentsCol,
  shiftInstancesCol,
  shiftTemplatesCol,
  usersCol,
  leaveRequestsCol,
  timeEntryDisputesCol,
} from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { useWriteOperational } from '@/lib/write'
import type { LeaveCoverageItem, LeaveType, User } from '@/lib/types'

export type SelfIdentity = { id: string; user: User } | null

/** Resolves the signed-in personal login's own users doc — null while
 *  loading, or permanently null if this account was never linked (see
 *  "Granting personal access" in the spec). */
export function useSelfIdentity(): { identity: SelfIdentity; loading: boolean } {
  const auth = useAuth()
  const [identity, setIdentity] = useState<SelfIdentity>(null)
  const [loading, setLoading] = useState(true)
  const managedUid = auth.mode === 'managed' ? auth.user.uid : null

  useEffect(() => {
    if (!managedUid) {
      setIdentity(null)
      setLoading(false)
      return
    }
    const q = query(usersCol, where('authUid', '==', managedUid))
    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0]
        setIdentity(d ? { id: d.id, user: d.data() } : null)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [managedUid])

  return { identity, loading }
}

export type EligibilityStatus = { eligible: boolean; eligibleFrom: Date | null; monthsSetting: number | null }

function monthsAfter(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export function computeEligibility(hiredAt: Date, months: number | null, now: Date): EligibilityStatus {
  if (months === null) return { eligible: false, eligibleFrom: null, monthsSetting: null }
  const eligibleFrom = monthsAfter(hiredAt, months)
  return { eligible: now >= eligibleFrom, eligibleFrom, monthsSetting: months }
}

/** Computed once, at submission, then frozen on the request — never
 *  recomputed on read (docs/14-M9-EMPLOYEE-SELF-SERVICE.md). */
export async function computeCoverageSnapshot(
  branchId: string,
  selfUserId: string,
  startDate: string,
  endDate: string,
): Promise<LeaveCoverageItem[]> {
  const mySnap = await getDocs(
    query(
      rosterAssignmentsCol,
      where('branchId', '==', branchId),
      where('userId', '==', selfUserId),
      where('status', 'in', ['planned', 'confirmed']),
    ),
  )
  const affected = mySnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => {
      const date = (a.businessDayId ?? '').slice(branchId.length + 1)
      return date >= startDate && date <= endDate
    })

  const items: LeaveCoverageItem[] = []
  for (const assignment of affected) {
    const shiftSnap = await getDoc(doc(shiftInstancesCol, assignment.shiftInstanceId))
    const shift = shiftSnap.data()
    if (!shift) continue
    const templateSnap = await getDoc(doc(shiftTemplatesCol, shift.templateId))
    const minRequired = templateSnap.data()?.targetHeadcount.min ?? 0

    const allSnap = await getDocs(
      query(
        rosterAssignmentsCol,
        where('branchId', '==', branchId),
        where('shiftInstanceId', '==', assignment.shiftInstanceId),
        where('status', 'in', ['planned', 'confirmed']),
      ),
    )
    const assignedCount = allSnap.size
    items.push({
      shiftInstanceId: assignment.shiftInstanceId,
      templateName: shift.templateName,
      date: (assignment.businessDayId ?? '').slice(branchId.length + 1),
      assignedCount,
      minRequired,
      wouldBeShort: assignedCount - 1 < minRequired,
    })
  }
  return items
}

export function useSelfServiceActions() {
  const { write, correct } = useWriteOperational()
  const activeBranch = useActiveBranch()

  async function requestLeave(input: {
    selfUserId: string
    selfUserName: string
    type: LeaveType
    startDate: string
    endDate: string
    reason: string
  }): Promise<string> {
    if (!activeBranch) throw new Error('No active branch resolved yet.')
    const coverageSnapshot = await computeCoverageSnapshot(activeBranch.branchId, input.selfUserId, input.startDate, input.endDate)
    return write('leaveRequests', {
      userId: input.selfUserId,
      userName: input.selfUserName,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
      coverageSnapshot,
      status: 'pending',
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      decisionNote: '',
    })
  }

  async function decideLeave(
    requestId: string,
    decision: 'approved' | 'denied',
    decidedById: string,
    decidedByName: string,
    note: string,
  ): Promise<void> {
    await updateDoc(doc(leaveRequestsCol, requestId), {
      status: decision,
      decidedBy: decidedById,
      decidedByName,
      decidedAt: serverTimestamp(),
      decisionNote: note,
    })
  }

  async function flagDispute(input: {
    selfUserId: string
    selfUserName: string
    timeEntryId: string
    reason: string
  }): Promise<string> {
    return write('timeEntryDisputes', {
      userId: input.selfUserId,
      userName: input.selfUserName,
      timeEntryId: input.timeEntryId,
      reason: input.reason,
      status: 'open',
      resolvedBy: null,
      resolvedByName: null,
      resolvedAt: null,
      correctionEntryId: null,
    })
  }

  /** Resolving a dispute reuses the existing correct() path on timeEntries
   *  (built and tested in M3) — never an edit of the original entry. */
  async function resolveDispute(
    dispute: { id: string; timeEntryId: string },
    correctionData: {
      userId: string
      userName: string
      type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
      at: Date
      photoRef: string | null
    },
    correctionReason: string,
    resolvedById: string,
    resolvedByName: string,
  ): Promise<void> {
    const correctionEntryId = await correct(
      'timeEntries',
      dispute.timeEntryId,
      { ...correctionData, at: Timestamp.fromDate(correctionData.at), method: 'correction' as const },
      correctionReason,
    )
    await updateDoc(doc(timeEntryDisputesCol, dispute.id), {
      status: 'resolved',
      resolvedBy: resolvedById,
      resolvedByName,
      resolvedAt: serverTimestamp(),
      correctionEntryId,
    })
  }

  return { requestLeave, decideLeave, flagDispute, resolveDispute }
}
