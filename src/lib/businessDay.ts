// Business day resolution — write once, correctly, never recompute a
// business day boundary anywhere else (docs/03-M0-FOUNDATION.md §8).
import { useEffect, useState } from 'react'
import { doc, getDoc, getDocs, query, runTransaction, where, Timestamp } from 'firebase/firestore'
import { db, businessDaysCol, shiftInstancesCol, shiftTemplatesCol } from './firebase'
import { useActiveBranch } from './branch'
import { parseHHMM, shiftDateStrByDays, manilaWallClock, manilaWallClockToInstant } from './manila'
import type { Branch, ShiftInstance } from './types'

/** The business date (YYYY-MM-DD) that an instant belongs to, given the
 *  branch's cutoff. A cutoff of '24:00' (or '00:00') means the business
 *  day is just the calendar day. Any other cutoff means a timestamp before
 *  that time-of-day belongs to the *previous* business date — this is what
 *  makes 01:00 in a 24/7 branch with a 04:00 cutoff belong to yesterday. */
export function computeBusinessDate(instant: Date, businessDayCutoff: string): string {
  const cutoffMin = parseHHMM(businessDayCutoff) % 1440
  const { dateStr, minutesSinceMidnight } = manilaWallClock(instant)
  if (cutoffMin === 0) return dateStr
  return minutesSinceMidnight < cutoffMin ? shiftDateStrByDays(dateStr, -1) : dateStr
}

/** Runs the check-then-create as one transaction — not just belt-and-braces:
 *  two devices (or React StrictMode's double effect-invocation in dev) can
 *  race this on the same business day. A plain getDoc-then-setDoc lets the
 *  loser's write land as an "update" of a doc it never saw, which security
 *  rules correctly refuse for a non-manager. A transaction makes the loser's
 *  read see the winner's write and simply do nothing. */
async function ensureBusinessDay(branchId: string, businessDayId: string, businessDate: string, branch: Branch) {
  const ref = doc(businessDaysCol, businessDayId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists()) return

    const opensAt = manilaWallClockToInstant(businessDate, branch.openTime)
    const closesAt =
      branch.operatingMode === '24_7'
        ? manilaWallClockToInstant(shiftDateStrByDays(businessDate, 1), branch.businessDayCutoff)
        : manilaWallClockToInstant(businessDate, branch.closeTime)

    tx.set(ref, {
      branchId,
      businessDate,
      opensAt: Timestamp.fromDate(opensAt),
      closesAt: Timestamp.fromDate(closesAt),
      status: 'open',
      closedBy: null,
      closedAt: null,
    })
  })
}

/** A template's window may cross midnight (e.g. Overnight 22:00-06:00) —
 *  when endTime is numerically <= startTime, the end falls on the next
 *  calendar date. Instance IDs are deterministic (`{businessDayId}_{templateId}`)
 *  so the existence check is a getDoc-by-ref, not a query — transactions
 *  can't run arbitrary queries, and a deterministic ID sidesteps the same
 *  create/update race described on ensureBusinessDay above. */
async function ensureShiftInstances(branchId: string, businessDayId: string, businessDate: string) {
  const templatesSnap = await getDocs(
    query(shiftTemplatesCol, where('branchId', '==', branchId), where('active', '==', true)),
  )

  for (const templateDoc of templatesSnap.docs) {
    const template = templateDoc.data()
    const ref = doc(shiftInstancesCol, `${businessDayId}_${templateDoc.id}`)

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists()) return

      const crossesMidnight = parseHHMM(template.endTime) <= parseHHMM(template.startTime)
      const plannedStart = manilaWallClockToInstant(businessDate, template.startTime)
      const plannedEnd = manilaWallClockToInstant(
        crossesMidnight ? shiftDateStrByDays(businessDate, 1) : businessDate,
        template.endTime,
      )

      tx.set(ref, {
        branchId,
        businessDayId,
        templateId: templateDoc.id,
        templateName: template.name,
        plannedStart: Timestamp.fromDate(plannedStart),
        plannedEnd: Timestamp.fromDate(plannedEnd),
        actualStart: null,
        actualEnd: null,
        status: 'planned',
        leaderId: null,
      })
    })
  }
}

export type ResolvedShift = ShiftInstance & { id: string }

// A manager's manual override, in case automatic resolution is ever wrong
// (M0 spec §8). Session-local by design — it's an escape hatch for today,
// not a standing configuration change.
let manualOverrideId: string | null = null
const overrideListeners = new Set<() => void>()

export function setShiftOverride(shiftInstanceId: string | null) {
  manualOverrideId = shiftInstanceId
  overrideListeners.forEach((l) => l())
}

export function getShiftOverride(): string | null {
  return manualOverrideId
}

export function useCurrentBusinessDayId(): string | null {
  const activeBranch = useActiveBranch()
  const [businessDayId, setBusinessDayId] = useState<string | null>(null)

  useEffect(() => {
    if (!activeBranch) return
    const compute = () => {
      const date = computeBusinessDate(new Date(), activeBranch.branch.businessDayCutoff)
      setBusinessDayId(`${activeBranch.branchId}_${date}`)
    }
    compute()
    const id = setInterval(compute, 60_000)
    return () => clearInterval(id)
  }, [activeBranch])

  return businessDayId
}

export function useCurrentShift(): ResolvedShift | null {
  const activeBranch = useActiveBranch()
  const [shift, setShift] = useState<ResolvedShift | null>(null)
  const [overrideVersion, setOverrideVersion] = useState(0)

  useEffect(() => {
    const listener = () => setOverrideVersion((n) => n + 1)
    overrideListeners.add(listener)
    return () => {
      overrideListeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    if (!activeBranch) return
    let cancelled = false
    const { branchId, branch } = activeBranch

    async function resolve() {
      const now = new Date()
      const businessDate = computeBusinessDate(now, branch.businessDayCutoff)
      const businessDayId = `${branchId}_${businessDate}`

      await ensureBusinessDay(branchId, businessDayId, businessDate, branch)
      await ensureShiftInstances(branchId, businessDayId, businessDate)

      if (manualOverrideId) {
        const overrideSnap = await getDoc(doc(shiftInstancesCol, manualOverrideId))
        if (!cancelled && overrideSnap.exists()) {
          setShift({ id: overrideSnap.id, ...overrideSnap.data() })
          return
        }
      }

      const snap = await getDocs(
        query(shiftInstancesCol, where('businessDayId', '==', businessDayId), where('branchId', '==', branchId)),
      )
      const nowMs = now.getTime()
      let match: ResolvedShift | null = null
      snap.forEach((d) => {
        const data = d.data()
        if (nowMs >= data.plannedStart.toMillis() && nowMs < data.plannedEnd.toMillis()) {
          match = { id: d.id, ...data }
        }
      })
      if (!cancelled) setShift(match)
    }

    resolve()
    const interval = setInterval(resolve, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeBranch, overrideVersion])

  return shift
}
