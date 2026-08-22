// The business logic behind cash control — sessions, drops, the blind
// count/reveal, and the void/refund/override/no-sale log. Built on
// useWriteOperational() so every write here still gets the five stamps and
// an audit entry for free (docs/01-ARCHITECTURE.md rule 1).
import { doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { cashCloseCountsCol, cashDropsCol, cashRegisterExceptionsCol, cashSessionsCol } from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import { useActiveBranch } from '@/lib/branch'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import type { CashRegisterExceptionType, CashSession } from '@/lib/types'

export function useCashActions() {
  const { write } = useWriteOperational()
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()

  function currentActor(): { userId: string; userName: string } {
    if (actor) return { userId: actor.userId, userName: actor.displayName }
    if (auth.mode === 'managed') return { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
    throw new Error('No actor set.')
  }

  async function findOpenSession(): Promise<(CashSession & { id: string }) | null> {
    if (!activeBranch) return null
    const who = currentActor()
    const snap = await getDocs(
      query(
        cashSessionsCol,
        where('branchId', '==', activeBranch.branchId),
        where('userId', '==', who.userId),
        where('status', '==', 'open'),
        limit(1),
      ),
    )
    const d = snap.docs[0]
    return d ? { id: d.id, ...d.data() } : null
  }

  /** Reuses an existing open session for this actor rather than starting a
   *  second one — docs/09-M4-CASH-CONTROL.md §1 acceptance criteria. */
  async function openSession(openingFloatCentavos: number): Promise<string> {
    const existing = await findOpenSession()
    if (existing) return existing.id
    const who = currentActor()
    return write('cashSessions', {
      userId: who.userId,
      userName: who.userName,
      openedAt: serverTimestamp(),
      openingFloatCentavos,
      status: 'open',
      closedAt: null,
    })
  }

  async function closeSession(sessionId: string): Promise<void> {
    await updateDoc(doc(cashSessionsCol, sessionId), { status: 'closed', closedAt: serverTimestamp() })
  }

  async function logDrop(sessionId: string, amountCentavos: number, bagNumber: string): Promise<string> {
    return write('cashDrops', {
      sessionId,
      amountCentavos,
      bagNumber,
      status: 'dropped',
      receivedBy: null,
      receivedAt: null,
    })
  }

  async function confirmDropReceipt(dropId: string, receivedByName: string): Promise<void> {
    await updateDoc(doc(cashDropsCol, dropId), {
      status: 'received',
      receivedBy: receivedByName,
      receivedAt: serverTimestamp(),
    })
  }

  /** The blind count. No expected figure is read, fetched, or passed in
   *  here — this is the one call site that must never gain a second
   *  parameter for it (docs/09-M4-CASH-CONTROL.md §4). */
  async function submitBlindCount(sessionId: string, countedCentavos: number): Promise<string> {
    const who = currentActor()
    return write('cashCloseCounts', {
      sessionId,
      countedCentavos,
      countedAt: serverTimestamp(),
      countedBy: who.userName,
      expectedCentavos: null,
      revealedBy: null,
      revealedAt: null,
      varianceCentavos: null,
      requiresInvestigation: false,
      investigationNote: '',
      status: 'counted',
    })
  }

  /** A separate action, by a different screen, from submitBlindCount — the
   *  variance is computed only here, never before (docs/09-M4-CASH-CONTROL.md §5). */
  async function revealExpected(
    countId: string,
    countedCentavos: number,
    expectedCentavos: number,
    revealedByName: string,
    investigationThresholdCentavos: number | null,
  ): Promise<{ varianceCentavos: number; requiresInvestigation: boolean }> {
    const varianceCentavos = countedCentavos - expectedCentavos
    const requiresInvestigation =
      investigationThresholdCentavos !== null && Math.abs(varianceCentavos) >= investigationThresholdCentavos
    await updateDoc(doc(cashCloseCountsCol, countId), {
      expectedCentavos,
      revealedBy: revealedByName,
      revealedAt: serverTimestamp(),
      varianceCentavos,
      requiresInvestigation,
      status: 'revealed',
    })
    return { varianceCentavos, requiresInvestigation }
  }

  async function setInvestigationNote(countId: string, note: string): Promise<void> {
    await updateDoc(doc(cashCloseCountsCol, countId), { investigationNote: note })
  }

  async function latestCountForSession(sessionId: string) {
    if (!activeBranch) return null
    const snap = await getDocs(
      query(
        cashCloseCountsCol,
        where('branchId', '==', activeBranch.branchId),
        where('sessionId', '==', sessionId),
        orderBy('createdAt', 'desc'),
        limit(1),
      ),
    )
    const d = snap.docs[0]
    return d ? { id: d.id, ...d.data() } : null
  }

  async function logRegisterException(
    sessionId: string | null,
    type: CashRegisterExceptionType,
    amountCentavos: number | null,
    reason: string,
    approvalRequired: boolean,
  ): Promise<string> {
    return write('cashRegisterExceptions', {
      sessionId: sessionId ?? '',
      type,
      amountCentavos,
      reason,
      approvalRequired,
      approvedBy: null,
      approvedAt: null,
    })
  }

  async function approveRegisterException(id: string, approvedByName: string): Promise<void> {
    await updateDoc(doc(cashRegisterExceptionsCol, id), {
      approvedBy: approvedByName,
      approvedAt: serverTimestamp(),
    })
  }

  return {
    currentActor,
    findOpenSession,
    openSession,
    closeSession,
    logDrop,
    confirmDropReceipt,
    submitBlindCount,
    revealExpected,
    setInvestigationNote,
    latestCountForSession,
    logRegisterException,
    approveRegisterException,
  }
}
