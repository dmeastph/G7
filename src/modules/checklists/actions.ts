// Checklist run scheduling and response logic — docs/07-M2-CHECKLISTS.md.
// Run creation reuses the deterministic-id + transaction pattern from
// lib/businessDay.ts's ensureShiftInstances: two devices (or React
// StrictMode) racing to create today's run must not produce a duplicate or
// an update-classified write a non-manager can't make.
import { doc, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, Timestamp } from 'firebase/firestore'
import { db, checklistRunsCol, exceptionsCol } from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import { useActiveBranch } from '@/lib/branch'
import { generateSlots, slotStatus, type Slot } from '@/lib/slots'
import type { ChecklistTemplate, ChecklistItem, ChecklistItemType } from '@/lib/types'

// No dedicated checklist grace parameter exists in docs/05-PARAMETERS.md,
// and the seed script is explicit about not inventing values not in that
// file — this reuses equipment.reading_grace_minutes (45), the closest
// seeded "how late before it's overdue" operational value, rather than a
// hardcoded magic number. Split into its own parameter if the manual ever
// specifies a different grace period for checklists.
export const CHECKLIST_GRACE_PARAM_KEY = 'equipment.reading_grace_minutes'

const PERIODIC_CATEGORIES = new Set(['ramyeon_station', 'dining', 'general'])

/** Opening/closing are one run per business day; periodic categories get
 *  one run per interval slot. Both paths land in the same checklistRuns
 *  shape so the run screen doesn't need to know which kind it's looking at. */
export async function ensureChecklistRuns(
  branchId: string,
  businessDayId: string,
  opensAt: Date,
  closesAt: Date,
  templates: (ChecklistTemplate & { id: string })[],
  intervalMinutesByCategory: Record<string, number | null>,
): Promise<void> {
  for (const template of templates) {
    if (!template.active) continue

    if (PERIODIC_CATEGORIES.has(template.category)) {
      const intervalMinutes = intervalMinutesByCategory[template.category]
      if (!intervalMinutes) continue // interval parameter unset — nothing to schedule yet
      const slots = generateSlots(opensAt, closesAt, intervalMinutes)
      for (const slot of slots) {
        await ensureRun(branchId, businessDayId, template, slot.label, slot.start)
      }
    } else {
      // opening/closing: single slot spanning the whole business day
      const dueAt = template.category === 'opening' ? opensAt : closesAt
      await ensureRun(branchId, businessDayId, template, template.category, dueAt)
    }
  }
}

async function ensureRun(
  branchId: string,
  businessDayId: string,
  template: ChecklistTemplate & { id: string },
  slotLabel: string,
  dueAt: Date,
): Promise<void> {
  const ref = doc(checklistRunsCol, `${template.id}_${businessDayId}_${slotLabel}`)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists()) return
    tx.set(ref, {
      branchId,
      businessDayId,
      shiftInstanceId: null,
      actorId: 'system',
      actorName: 'System (scheduled)',
      createdAt: serverTimestamp(),
      deviceId: 'scheduler',
      templateId: template.id,
      templateVersion: template.version,
      templateName: template.name,
      category: template.category,
      scheduledSlot: slotLabel,
      dueAt: Timestamp.fromDate(dueAt),
      status: 'due',
      startedAt: null,
      completedAt: null,
      completedBy: null,
      itemCount: template.items.length,
      passCount: 0,
      failCount: 0,
    })
  })
}

/** ensureChecklistRuns eagerly creates every slot for the whole trading day
 *  (36 of them for a 30-minute periodic check) — listing all of them would
 *  bury the one that actually needs attention. This picks the one run per
 *  template worth showing, the same "earliest not-done, else most recent"
 *  logic as M1's currentTargetSlot, just operating on real run documents
 *  (which have their own completed state) instead of abstract slots. */
export function pickCurrentRun<T extends { dueAt: { toDate: () => Date }; status: string }>(
  runsForTemplate: T[],
  now: Date,
): T | null {
  const started = runsForTemplate.filter((r) => r.dueAt.toDate() <= now)
  if (started.length === 0) return null
  const unfinished = started
    .filter((r) => r.status !== 'completed')
    .sort((a, b) => a.dueAt.toDate().getTime() - b.dueAt.toDate().getTime())
  if (unfinished.length > 0) return unfinished[0]
  return started.reduce((latest, r) => (r.dueAt.toDate() > latest.dueAt.toDate() ? r : latest))
}

/** `windowMinutes` is how long after `dueAt` this run's own slot lasts
 *  before it's genuinely missed — the periodic interval for ramyeon/dining
 *  /general, or minutes-to-business-day-close for opening/closing (there's
 *  no "next slot" for those; the business day ending is the natural
 *  boundary). This used to default to a flat 24 hours, which meant a run
 *  effectively never reached 'missed' — a real bug caught by testing this
 *  against real wall-clock time rather than just reading the code. */
export function computeRunStatus(
  dueAt: Date,
  now: Date,
  graceMinutes: number,
  windowMinutes: number,
  hasResponses: boolean,
  completed: boolean,
) {
  if (completed) return 'completed' as const
  if (hasResponses) return 'in_progress' as const
  const asSlot: Slot = { label: '', start: dueAt, end: new Date(dueAt.getTime() + windowMinutes * 60_000) }
  const status = slotStatus(asSlot, now, graceMinutes, false)
  if (status === 'due') return 'due' as const
  if (status === 'overdue') return 'overdue' as const
  return 'missed' as const
}

export function useChecklistActions() {
  const { write } = useWriteOperational()
  const activeBranch = useActiveBranch()

  async function respondToItem(
    runId: string,
    item: ChecklistItem,
    value: { bool?: boolean; number?: number; text?: string; photoRef?: string },
  ): Promise<void> {
    const withinRange =
      item.type === 'numeric' && value.number !== undefined
        ? (item.numericMin === null && item.numericMax === null
            ? null
            : (item.numericMin === null || value.number >= item.numericMin) &&
              (item.numericMax === null || value.number <= item.numericMax))
        : null

    const passed =
      item.type === 'pass_fail'
        ? Boolean(value.bool)
        : item.type === 'numeric'
          ? withinRange !== false
          : true // photo/text items always "pass" — they exist to capture evidence, not to gate

    await write('checklistResponses', {
      runId,
      itemId: item.id,
      itemLabel: item.label,
      type: item.type as ChecklistItemType,
      valueBool: value.bool ?? null,
      valueNumber: value.number ?? null,
      valueText: value.text ?? null,
      photoRef: value.photoRef ?? null,
      withinRange,
      passed,
    })

    const runRef = doc(checklistRunsCol, runId)
    const runSnap = await getDoc(runRef)
    if (!runSnap.exists()) return
    const run = runSnap.data()
    await updateDoc(runRef, {
      status: run.status === 'due' || run.status === 'overdue' || run.status === 'missed' ? 'in_progress' : run.status,
      startedAt: run.startedAt ?? serverTimestamp(),
      passCount: passed ? run.passCount + 1 : run.passCount,
      failCount: passed ? run.failCount : run.failCount + 1,
    })
  }

  async function completeRun(runId: string, completedByName: string): Promise<void> {
    await updateDoc(doc(checklistRunsCol, runId), {
      status: 'completed',
      completedAt: serverTimestamp(),
      completedBy: completedByName,
    })
  }

  async function raiseMissedRunException(run: { id: string; templateName: string; category: string; branchId: string }): Promise<void> {
    if (!activeBranch) return
    const existing = await getDocs(
      query(exceptionsCol, where('branchId', '==', activeBranch.branchId), where('sourceId', '==', run.id)),
    )
    if (!existing.empty) return
    await write('exceptions', {
      source: 'checklist',
      sourceId: run.id,
      severity: 'medium',
      title: `${run.templateName} missed`,
      detail: `The ${run.category} checklist was not run for its scheduled slot.`,
      ownerRole: 'shift_leader',
      ownerId: null,
      dueAt: null,
      status: 'open',
      carriedForwardCount: 0,
      correctiveAction: null,
      lastCarriedForwardBusinessDayId: null,
    })
  }

  return { respondToItem, completeRun, raiseMissedRunException }
}
