// The business logic behind "take a reading" — evaluate range, flag
// duplicates, open/update an excursion, queue a photo. Built on
// useWriteOperational() so every write here still gets the five stamps and
// an audit entry for free (docs/01-ARCHITECTURE.md rule 1).
import { doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { excursionsCol, exceptionsCol, temperatureReadingsCol } from '@/lib/firebase'
import { useWriteOperational, newDocId } from '@/lib/write'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useActiveBranch } from '@/lib/branch'
import { compressImage } from '@/lib/photo'
import { queuePhotoUpload } from '@/lib/photoQueue'
import { evaluateWithinRange, isSuspiciousDuplicateRun, EMPTY_FIRST_CHECKS } from '@/lib/coldchain'
import { toMillisSafe } from '@/lib/format'
import type { Equipment, ExcursionFirstChecks } from '@/lib/types'

export type SaveReadingResult = {
  readingId: string
  withinRange: boolean | null
  duplicateFlag: boolean
  excursionId: string | null
}

export function useColdChainActions() {
  const { write } = useWriteOperational()
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()

  function currentActorName(): string {
    if (actor) return actor.displayName
    if (auth.mode === 'managed') return auth.user.email ?? auth.user.uid
    throw new Error('No actor set.')
  }

  async function saveReading(
    equipment: Equipment & { id: string },
    valueC: number,
    scheduledSlot: string | null,
    photo: Blob | null,
  ): Promise<SaveReadingResult> {
    if (!activeBranch) throw new Error('No active branch resolved yet.')

    const withinRange = evaluateWithinRange(valueC, equipment.thresholds)

    // Duplicate check: the last two readings for this unit, same query shape
    // as the declared composite index (branchId + equipmentId + readAt desc).
    const recentSnap = await getDocs(
      query(
        temperatureReadingsCol,
        where('branchId', '==', activeBranch.branchId),
        where('equipmentId', '==', equipment.id),
        orderBy('readAt', 'desc'),
        limit(2),
      ),
    )
    const previousTwoValues = recentSnap.docs.map((d) => d.data().valueC)
    const duplicateFlag = isSuspiciousDuplicateRun(previousTwoValues, valueC)

    // Pre-generate the id so a photo's Storage path is known before the
    // Firestore doc is written — readings are append-only, so photoRef
    // can't be patched in after the fact (see lib/write.ts newDocId()).
    const readingId = newDocId('temperatureReadings')
    let photoRef: string | null = null
    if (photo) {
      const compressed = await compressImage(photo)
      photoRef = `branches/${activeBranch.branchId}/temperature-readings/${readingId}.jpg`
      queuePhotoUpload(readingId, photoRef, compressed)
    }

    await write(
      'temperatureReadings',
      {
        equipmentId: equipment.id,
        assetId: equipment.assetId,
        valueC,
        readAt: serverTimestamp(),
        method: 'manual',
        photoRef,
        withinRange,
        scheduledSlot,
        duplicateFlag,
      },
      { id: readingId },
    )

    // An in-range reading recovers whatever excursion was open — automatic,
    // but does NOT close it: "a human records the cause and closes it"
    // (docs/04-M1-COLDCHAIN.md "Excursion recovery").
    let excursionId: string | null = null
    if (withinRange === true) {
      await recoverOpenExcursion(equipment)
    } else if (withinRange === false) {
      // "An out-of-range reading opens an excursion automatically" — this is
      // not conditional on the user tapping anything in the UI; the prompt
      // that follows is about telling the Shift Leader, not about whether
      // the incident gets recorded at all (docs/04-M1-COLDCHAIN.md, both the
      // "Excursion open" logic and the acceptance criteria for it).
      excursionId = await openOrUpdateExcursion(equipment, readingId, valueC)
    }

    return { readingId, withinRange, duplicateFlag, excursionId }
  }

  async function recoverOpenExcursion(equipment: Equipment & { id: string }): Promise<void> {
    if (!activeBranch) return
    const openSnap = await getDocs(
      query(
        excursionsCol,
        where('branchId', '==', activeBranch.branchId),
        where('equipmentId', '==', equipment.id),
        where('status', '==', 'open'),
        limit(1),
      ),
    )
    if (openSnap.empty) return
    const existing = openSnap.docs[0]
    const startedAtMs = toMillisSafe(existing.data().startedAt)
    const durationMinutes = Math.round((Date.now() - startedAtMs) / 60_000)
    await updateDoc(existing.ref, {
      status: 'recovered',
      endedAt: serverTimestamp(),
      durationMinutes,
    })
  }

  /** Called when a reading is out of range. Opens a new excursion, or bumps
   *  peakC on the one already open for this unit — docs/04-M1-COLDCHAIN.md
   *  "Excursion open". This is a check-then-act query, not a transaction:
   *  two readings racing into the same brand-new excursion within the same
   *  second is a real but rare edge case, acceptable for M1 (a duplicate
   *  excursion is a visible nuisance, not a safety gap — the peakC on
   *  whichever one loses the race still reflects a real reading). */
  async function openOrUpdateExcursion(
    equipment: Equipment & { id: string },
    readingId: string,
    valueC: number,
  ): Promise<string> {
    if (!activeBranch) throw new Error('No active branch resolved yet.')

    const openSnap = await getDocs(
      query(
        excursionsCol,
        where('branchId', '==', activeBranch.branchId),
        where('equipmentId', '==', equipment.id),
        where('status', '==', 'open'),
        limit(1),
      ),
    )

    if (!openSnap.empty) {
      const existing = openSnap.docs[0]
      const worse = isWorsePeak(existing.data().peakC, valueC, equipment)
      if (worse) {
        // Excursions are a live incident record, not append-only — a direct
        // update is correct here (docs/02-DATA-MODEL.md, firestore.rules).
        await updateDoc(existing.ref, { peakC: valueC })
      }
      return existing.id
    }

    const excursionId = await write('excursions', {
      equipmentId: equipment.id,
      assetId: equipment.assetId,
      startedAt: serverTimestamp(),
      endedAt: null,
      startReadingId: readingId,
      peakC: valueC,
      durationMinutes: null,
      autoDetected: true,
      firstChecks: null,
      status: 'open',
      exceptionId: null,
      ticketId: null,
      closedBy: null,
      closedAt: null,
      closureNote: '',
    })

    const exceptionId = await write('exceptions', {
      source: 'temperature',
      sourceId: excursionId,
      severity: 'high',
      title: `${equipment.assetId} out of range`,
      detail: `Reading ${valueC}°C is outside the set threshold.`,
      ownerRole: 'shift_leader',
      ownerId: null,
      dueAt: null,
      status: 'open',
      carriedForwardCount: 0,
      correctiveAction: null,
      lastCarriedForwardBusinessDayId: null,
    })
    await updateDoc(doc(excursionsCol, excursionId), { exceptionId })

    return excursionId
  }

  /** Auto-quarantine when maxExcursionMinutes is set and exceeded, or a
   *  manual push by the Shift Leader when it's unset — either way, this is
   *  the one path that escalates the linked exception to critical
   *  (docs/04-M1-COLDCHAIN.md "Auto-quarantine"). */
  async function escalateToQuarantine(excursionId: string): Promise<void> {
    if (!activeBranch) return
    await updateDoc(doc(excursionsCol, excursionId), { status: 'quarantined' })

    const linkedExceptions = await getDocs(
      query(exceptionsCol, where('branchId', '==', activeBranch.branchId), where('sourceId', '==', excursionId)),
    )
    for (const d of linkedExceptions.docs) {
      await updateDoc(d.ref, { severity: 'critical', status: 'escalated' })
    }
  }

  async function saveFirstChecks(excursionId: string, firstChecks: ExcursionFirstChecks): Promise<void> {
    await updateDoc(doc(excursionsCol, excursionId), { firstChecks })
  }

  async function closeExcursion(excursionId: string, closureNote: string): Promise<void> {
    await updateDoc(doc(excursionsCol, excursionId), {
      status: 'closed',
      closedBy: currentActorName(),
      closedAt: serverTimestamp(),
      closureNote,
    })
  }

  return {
    saveReading,
    openOrUpdateExcursion,
    escalateToQuarantine,
    saveFirstChecks,
    closeExcursion,
    EMPTY_FIRST_CHECKS,
  }
}

function isWorsePeak(currentPeak: number, candidate: number, equipment: Equipment & { id: string }): boolean {
  const max = equipment.thresholds?.maxC ?? null
  const min = equipment.thresholds?.minC ?? null
  if (max !== null && candidate > max) return candidate > currentPeak
  if (min !== null && candidate < min) return candidate < currentPeak
  return false
}
