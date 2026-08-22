// The one write path for operational data (docs/01-ARCHITECTURE.md rule 1).
// No component calls setDoc/addDoc directly on an operational collection —
// everything goes through here so the five stamps and the audit entry are
// never something a future screen forgets.
import { collection, doc, serverTimestamp, writeBatch, type WriteBatch } from 'firebase/firestore'
import { db, auditLogCol } from './firebase'
import { getDeviceId } from './deviceId'
import { useAuth } from './auth'
import { usePinSession } from './pin'
import { useActiveBranch } from './branch'
import { useCurrentBusinessDayId, useCurrentShift } from './businessDay'
import { notePendingWrite } from './offline'

/** batch.commit()'s Promise waits for the backend to acknowledge the write
 *  — even with persistentLocalCache enabled, it does NOT resolve just
 *  because the mutation reached the local queue. Awaiting it would freeze
 *  every write button for the entire length of an outage, which fails the
 *  "give feedback within 100ms, optimistically" target (docs/01-ARCHITECTURE.md)
 *  and the whole point of building this offline-first. The write is already
 *  safely queued (Firestore owns that, durably, before this call returns)
 *  the moment writeOperational()'s caller gets its id back — commit
 *  finishing is background business, tracked by the pending-write banner
 *  instead of the caller's own await.
 */
function commitInBackground(batch: WriteBatch) {
  batch.commit().catch((err) => {
    console.error('Operational write failed to sync', err)
  })
}

/** A fresh random doc id, generated client-side with no network call —
 *  for a caller that needs the id before write() runs (see opts.id above). */
export function newDocId(collectionName: string): string {
  return doc(collection(db, collectionName)).id
}

function resolveActor(
  pinActor: { userId: string; displayName: string } | null,
  auth: ReturnType<typeof useAuth>,
): { actorId: string; actorName: string } | null {
  if (pinActor) return { actorId: pinActor.userId, actorName: pinActor.displayName }
  if (auth.mode === 'managed') return { actorId: auth.user.uid, actorName: auth.user.email ?? auth.user.uid }
  return null
}

export function useWriteOperational() {
  const { actor } = usePinSession()
  const auth = useAuth()
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const currentShift = useCurrentShift()

  async function write<T extends object>(collectionName: string, data: T, opts?: { id?: string }): Promise<string> {
    const who = resolveActor(actor, auth)
    if (!who) throw new Error('No actor set — cannot write an operational record without one.')
    if (!activeBranch) throw new Error('No active branch resolved yet.')

    const deviceId = getDeviceId()
    const base = {
      branchId: activeBranch.branchId,
      businessDayId: businessDayId ?? null,
      shiftInstanceId: currentShift?.id ?? null,
      actorId: who.actorId,
      actorName: who.actorName,
      createdAt: serverTimestamp(),
      deviceId,
    }

    const batch = writeBatch(db)
    // A caller that needs the id before the write lands (e.g. to target a
    // Storage path for an attached photo) can pre-generate one with
    // newDocId() and pass it here — same doc(collection) mechanism, just
    // called by the caller first instead of internally.
    const targetRef = opts?.id ? doc(collection(db, collectionName), opts.id) : doc(collection(db, collectionName))
    batch.set(targetRef, { ...data, ...base })

    const auditRef = doc(auditLogCol)
    batch.set(auditRef, {
      entity: collectionName,
      entityId: targetRef.id,
      action: 'create',
      before: null,
      after: { ...data, ...base } as Record<string, unknown>,
      actorId: who.actorId,
      actorName: who.actorName,
      at: serverTimestamp(),
      deviceId,
      branchId: activeBranch.branchId,
    })

    notePendingWrite()
    commitInBackground(batch)
    return targetRef.id
  }

  /** Corrections are new documents, never edits. `originalId` is carried
   *  forward so the correction is traceable; the original is untouched. */
  async function correct<T extends object>(
    collectionName: string,
    originalId: string,
    data: T,
    reason: string,
  ): Promise<string> {
    const who = resolveActor(actor, auth)
    if (!who) throw new Error('No actor set — cannot write an operational record without one.')
    if (!activeBranch) throw new Error('No active branch resolved yet.')
    if (!reason.trim()) throw new Error('A correction requires a reason.')

    const deviceId = getDeviceId()
    const base = {
      branchId: activeBranch.branchId,
      businessDayId: businessDayId ?? null,
      shiftInstanceId: currentShift?.id ?? null,
      actorId: who.actorId,
      actorName: who.actorName,
      createdAt: serverTimestamp(),
      deviceId,
      correctsId: originalId,
      correctionReason: reason,
    }

    const batch = writeBatch(db)
    const targetRef = doc(collection(db, collectionName))
    batch.set(targetRef, { ...data, ...base })

    const auditRef = doc(auditLogCol)
    batch.set(auditRef, {
      entity: collectionName,
      entityId: targetRef.id,
      action: 'correct',
      before: { correctsId: originalId },
      after: { ...data, ...base } as Record<string, unknown>,
      actorId: who.actorId,
      actorName: who.actorName,
      at: serverTimestamp(),
      deviceId,
      branchId: activeBranch.branchId,
    })

    notePendingWrite()
    commitInBackground(batch)
    return targetRef.id
  }

  return { write, correct }
}
