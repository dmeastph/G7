// docs/09-M4-CASH-CONTROL.md §1-5 — the drawer session hub: open with a
// float, log and confirm safe drops, blind-count and reveal at close.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { cashCloseCountsCol, cashDropsCol, cashSessionsCol, exceptionsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useParam } from '@/lib/params'
import { useWriteOperational } from '@/lib/write'
import { formatCentavos, formatTimeManila, toDateSafe, toMillisSafe } from '@/lib/format'
import { manilaWallClock } from '@/lib/manila'
import { generateSlots, slotStatus, currentTargetSlot, type Slot, type SlotStatus } from '@/lib/slots'
import { useCashActions } from './actions'
import type { CashCloseCount, CashDrop, CashSession } from '@/lib/types'

// A reminder timing only — unlike every dollar figure on this page, this
// number doesn't come from the seeded parameter set because it isn't a
// business or food-safety threshold, just how long the "drop due" tile
// waits before turning overdue. It gates a low-severity nudge, nothing else.
const DROP_REMINDER_GRACE_MINUTES = 20

const DROP_STATUS_LABEL: Record<SlotStatus, string> = { due: 'Due', overdue: 'Overdue', missed: 'Missed', done: 'Dropped' }

function useCentavosParam(key: string): number | null {
  const p = useParam(key)
  return p.isSet && typeof p.value === 'number' ? p.value : null
}

// Covers both steps a supervisor might owe a count: revealing the expected
// figure (status 'counted'), or — since only a supervisor's own managed
// account can write to cashCloseCounts, same as the reveal itself — adding
// the investigation note afterwards (status 'revealed', still missing one).
// A cashier's own station+PIN session can never satisfy that write, so the
// note can't live on their "my session" screen; it has to be handled here,
// by whoever is already revealing with the permission to do it.
function PendingRevealRow({
  count,
  onReveal,
  onSaveNote,
}: {
  count: CashCloseCount & { id: string }
  onReveal: (target: CashCloseCount & { id: string }, expected: string) => Promise<string | null>
  onSaveNote: (target: CashCloseCount & { id: string }, note: string) => Promise<void>
}) {
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitReveal() {
    setBusy(true)
    setError(null)
    try {
      const failure = await onReveal(count, expected)
      if (failure) setError(failure)
      else setExpected('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reveal the expected figure.')
    } finally {
      setBusy(false)
    }
  }

  async function submitNote() {
    setBusy(true)
    setError(null)
    try {
      await onSaveNote(count, note.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.')
    } finally {
      setBusy(false)
    }
  }

  if (count.status === 'revealed') {
    return (
      <li>
        {count.countedBy} — variance {formatCentavos(count.varianceCentavos ?? 0)} — needs an investigation note
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Investigation note" />
        <button type="button" onClick={submitNote} disabled={busy || !note.trim()}>
          Save note
        </button>
        {error && <p className="dialog__error">{error}</p>}
      </li>
    )
  }

  return (
    <li>
      {count.countedBy} counted {formatCentavos(count.countedCentavos)} at {formatTimeManila(count.countedAt)}
      <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="Expected (₱)" inputMode="decimal" />
      <button type="button" onClick={submitReveal} disabled={busy}>
        Reveal
      </button>
      {error && <p className="dialog__error">{error}</p>}
    </li>
  )
}

function PendingDropReceiptRow({
  drop,
  onConfirm,
  busy,
}: {
  drop: CashDrop & { id: string }
  onConfirm: (dropId: string) => void
  busy: boolean
}) {
  return (
    <li>
      Bag {drop.bagNumber} — {formatCentavos(drop.amountCentavos)} — dropped {formatTimeManila(drop.createdAt)}
      <button type="button" onClick={() => onConfirm(drop.id)} disabled={busy}>
        Confirm receipt
      </button>
    </li>
  )
}

export function CashSessionPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const actions = useCashActions()
  const { write } = useWriteOperational()

  const openingFloatRef = useCentavosParam('cash.opening_float')
  const dropIntervalMinutes = useCentavosParam('cash.drop_interval_minutes')
  const alertThreshold = useCentavosParam('cash.drawer_alert_threshold')
  const maxBalance = useCentavosParam('cash.drawer_max_balance')
  const maxAfter2200 = useCentavosParam('cash.drawer_max_after_2200')
  const investigationThreshold = useCentavosParam('cash.variance_investigation_threshold')
  const approvalLimit = useCentavosParam('cash.shift_leader_approval_limit')

  const role = auth.claims?.role ?? null
  const isSupervisor = role === 'shift_leader' || role === 'store_manager' || role === 'owner' || role === 'ops_head'
  const isManager = role === 'store_manager' || role === 'owner' || role === 'ops_head'

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [session, setSession] = useState<(CashSession & { id: string }) | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [openingFloatInput, setOpeningFloatInput] = useState('')
  const [drops, setDrops] = useState<(CashDrop & { id: string })[]>([])
  const [dropAmount, setDropAmount] = useState('')
  const [dropBag, setDropBag] = useState('')
  const [count, setCount] = useState<(CashCloseCount & { id: string }) | null>(null)
  const [pendingReveals, setPendingReveals] = useState<(CashCloseCount & { id: string })[]>([])
  const [pendingDropReceipts, setPendingDropReceipts] = useState<(CashDrop & { id: string })[]>([])
  const [countedInput, setCountedInput] = useState('')
  const [expectedInput, setExpectedInput] = useState('')
  const [now, setNow] = useState(new Date())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!activeBranch || !who) {
      setSession(null)
      setSessionLoading(false)
      return
    }
    setSessionLoading(true)
    const q = query(
      cashSessionsCol,
      where('branchId', '==', activeBranch.branchId),
      where('userId', '==', who.userId),
      where('status', '==', 'open'),
    )
    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0]
        setSession(d ? { id: d.id, ...d.data() } : null)
        setSessionLoading(false)
      },
      // This listener gates the whole page behind sessionLoading, same
      // severity as branch.ts's own listener — a denied/dropped stream that
      // never flips it back to false would hang the page on "Loading…"
      // forever, since Firestore doesn't retry a denied listener on its own.
      () => setSessionLoading(false),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, who?.userId])

  useEffect(() => {
    if (!activeBranch || !session) {
      setDrops([])
      return
    }
    const q = query(
      cashDropsCol,
      where('branchId', '==', activeBranch.branchId),
      where('sessionId', '==', session.id),
    )
    return onSnapshot(q, (snap) => setDrops(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, session?.id])

  useEffect(() => {
    if (!activeBranch || !session) {
      setCount(null)
      return
    }
    const q = query(
      cashCloseCountsCol,
      where('branchId', '==', activeBranch.branchId),
      where('sessionId', '==', session.id),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(q, (snap) => {
      const d = snap.docs[0]
      setCount(d ? { id: d.id, ...d.data() } : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, session?.id])

  // Branch-wide, not "my session" — a shift leader usually doesn't run a
  // personal drawer, they review other cashiers' closed-out counts. Single
  // equality filter on branchId, filtered client-side, same pattern as the
  // other log pages (WastageLogPage etc.) rather than adding a composite
  // index for a manager-only, low-volume list. Includes counts still
  // needing a reveal AND already-revealed ones still missing their required
  // investigation note — see the comment on PendingRevealRow for why the
  // note has to be handled here too, not on the cashier's own session view.
  useEffect(() => {
    if (!activeBranch || !isSupervisor) {
      setPendingReveals([])
      return
    }
    const q = query(cashCloseCountsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => {
      setPendingReveals(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => c.status === 'counted' || (c.status === 'revealed' && c.requiresInvestigation && !c.investigationNote)),
      )
    })
  }, [activeBranch, isSupervisor])

  // Same fix, same reason, for drop receipts: a manager confirms other
  // cashiers' drops far more often than their own, since managers don't
  // normally run a personal drawer either. Branch-wide, single equality
  // filter, client-side status filter — manager-only (isManager, not
  // isSupervisor) because confirmDropReceipt is gated by isManager() in the
  // Firestore rules, unlike revealExpected which shift leaders can also do.
  useEffect(() => {
    if (!activeBranch || !isManager) {
      setPendingDropReceipts([])
      return
    }
    const q = query(cashDropsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => {
      setPendingDropReceipts(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((d) => d.status === 'dropped'),
      )
    })
  }, [activeBranch, isManager])

  // Drop-due reminder — same generateSlots/slotStatus scheduling as M1
  // readings and M2 checklists, just applied to safe drops instead.
  const dropSlots: Slot[] = session
    ? generateSlots(toDateSafe(session.openedAt), session.closedAt ? toDateSafe(session.closedAt) : now, dropIntervalMinutes ?? 180)
    : []
  const doneDropLabels = new Set(
    dropSlots.filter((s) => drops.some((d) => toMillisSafe(d.createdAt) >= s.start.getTime() && toMillisSafe(d.createdAt) < s.end.getTime())).map((s) => s.label),
  )
  const currentDropSlot = currentTargetSlot(dropSlots, now, DROP_REMINDER_GRACE_MINUTES, doneDropLabels)
  const dropSlotStatus: SlotStatus | null = currentDropSlot
    ? slotStatus(currentDropSlot, now, DROP_REMINDER_GRACE_MINUTES, doneDropLabels.has(currentDropSlot.label))
    : null

  useEffect(() => {
    if (!activeBranch || !session) return
    let cancelled = false
    async function raiseMissedDrops() {
      for (const slot of dropSlots) {
        if (slotStatus(slot, now, DROP_REMINDER_GRACE_MINUTES, doneDropLabels.has(slot.label)) !== 'missed') continue
        const sourceId = `${session!.id}::${slot.label}`
        const existing = await getDocs(
          query(exceptionsCol, where('branchId', '==', activeBranch!.branchId), where('sourceId', '==', sourceId)),
        )
        if (cancelled || !existing.empty) continue
        await write('exceptions', {
          source: 'cash',
          sourceId,
          severity: 'low',
          title: 'Cash drop check missed',
          detail: `No safe drop was logged for the ${slot.label} interval.`,
          ownerRole: 'shift_leader',
          ownerId: null,
          dueAt: null,
          status: 'open',
          carriedForwardCount: 0,
          correctiveAction: null,
          lastCarriedForwardBusinessDayId: null,
        })
      }
    }
    raiseMissedDrops()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, session?.id, now.getMinutes()])

  const afterTenPM = manilaWallClock(now).minutesSinceMidnight >= 22 * 60

  async function handleOpenSession() {
    if (openingFloatInput.trim() === '') {
      setError('Enter the opening float.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await actions.openSession(Math.round(Number(openingFloatInput) * 100))
      setOpeningFloatInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the session.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogDrop() {
    if (!session || dropAmount.trim() === '' || !dropBag.trim()) {
      setError('Amount and bag number are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await actions.logDrop(session.id, Math.round(Number(dropAmount) * 100), dropBag.trim())
      setDropAmount('')
      setDropBag('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log this drop.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmReceipt(dropId: string) {
    if (!who) return
    setBusy(true)
    try {
      await actions.confirmDropReceipt(dropId, who.userName)
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitCount() {
    if (!session || countedInput.trim() === '') {
      setError('Enter the counted total.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await actions.submitBlindCount(session.id, Math.round(Number(countedInput) * 100))
      setCountedInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the count.')
    } finally {
      setBusy(false)
    }
  }

  /** Shared by "my session's" reveal form and the pending-reveals list below
   *  — a shift leader reveals someone else's count far more often than
   *  their own, since they usually don't run a personal drawer. */
  async function attemptReveal(target: CashCloseCount & { id: string }, expected: string): Promise<string | null> {
    if (!who || expected.trim() === '') return 'Enter the expected figure from the POS report.'
    if (approvalLimit !== null) {
      const provisional = target.countedCentavos - Math.round(Number(expected) * 100)
      if (Math.abs(provisional) > approvalLimit && !isManager) {
        return 'This variance exceeds the shift leader approval limit — a store manager or owner must reveal it.'
      }
    }
    await actions.revealExpected(target.id, target.countedCentavos, Math.round(Number(expected) * 100), who.userName, investigationThreshold)
    return null
  }

  async function handleReveal() {
    if (!count) return
    setBusy(true)
    setError(null)
    try {
      const failure = await attemptReveal(count, expectedInput)
      if (failure) setError(failure)
      else setExpectedInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reveal the expected figure.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCloseSession() {
    if (!session) return
    setBusy(true)
    try {
      await actions.closeSession(session.id)
    } finally {
      setBusy(false)
    }
  }

  if (sessionLoading) return <p>Loading…</p>

  const noteRequired = count?.requiresInvestigation && !count.investigationNote.trim()
  const canClose = session?.status === 'open' && count?.status === 'revealed' && !noteRequired

  return (
    <div className="cash-page">
      <h2>Cash session</h2>

      {!session && (
        <section className="card">
          <h2>Open drawer</h2>
          <p className="dialog__hint">
            Reference opening float: {openingFloatRef !== null ? formatCentavos(openingFloatRef) : 'not set'} — floats
            legitimately vary, this is not enforced.
          </p>
          <label>
            Opening float (₱)
            <input value={openingFloatInput} onChange={(e) => setOpeningFloatInput(e.target.value)} inputMode="decimal" />
          </label>
          {error && <p className="dialog__error">{error}</p>}
          <button type="button" onClick={handleOpenSession} disabled={busy}>
            {busy ? 'Opening…' : 'Open session'}
          </button>
        </section>
      )}

      {session && (
        <>
          <section className="card">
            <h2>
              {session.userName} — opened {formatTimeManila(session.openedAt)}
            </h2>
            <p>Opening float: {formatCentavos(session.openingFloatCentavos)}</p>
          </section>

          <section className="card">
            <h2>Safe drops</h2>
            <p className="dialog__hint">
              Reference: alert at {alertThreshold !== null ? formatCentavos(alertThreshold) : 'not set'}, drop down to at
              or below {maxBalance !== null ? formatCentavos(maxBalance) : 'not set'}
              {afterTenPM && maxAfter2200 !== null ? ` (${formatCentavos(maxAfter2200)} after 22:00)` : ''}. This is a
              reference figure, not a computed live balance — this system has no POS integration and doesn't know the
              drawer's actual contents.
            </p>
            {currentDropSlot && dropSlotStatus && dropSlotStatus !== 'done' && (
              <p className={dropSlotStatus === 'missed' || dropSlotStatus === 'overdue' ? 'dialog__warning' : 'dialog__hint'}>
                Drop check {DROP_STATUS_LABEL[dropSlotStatus].toLowerCase()} — interval since{' '}
                {formatTimeManila(currentDropSlot.start)}.
              </p>
            )}

            <label>
              Amount (₱)
              <input value={dropAmount} onChange={(e) => setDropAmount(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              Bag number
              <input value={dropBag} onChange={(e) => setDropBag(e.target.value)} />
            </label>
            <button type="button" onClick={handleLogDrop} disabled={busy}>
              Log drop
            </button>

            {drops.length === 0 && <p className="empty-state">No drops logged yet.</p>}
            <ul>
              {drops
                .slice()
                .sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))
                .map((d) => (
                  <li key={d.id}>
                    Bag {d.bagNumber} — {formatCentavos(d.amountCentavos)} — {d.status}
                    {d.status === 'dropped' && isManager && (
                      <button type="button" onClick={() => handleConfirmReceipt(d.id)} disabled={busy}>
                        Confirm receipt
                      </button>
                    )}
                    {d.status === 'received' && d.receivedBy && <span> — received by {d.receivedBy}</span>}
                  </li>
                ))}
            </ul>
          </section>

          <section className="card">
            <h2>Close count</h2>
            {!count && (
              <>
                <p className="dialog__warning">
                  <strong>Blind count.</strong> Count the drawer and enter the total below. The expected figure is not
                  shown until after you submit.
                </p>
                <label>
                  Counted total (₱)
                  <input value={countedInput} onChange={(e) => setCountedInput(e.target.value)} inputMode="decimal" />
                </label>
                <button type="button" onClick={handleSubmitCount} disabled={busy}>
                  Submit count
                </button>
              </>
            )}

            {count && count.status === 'counted' && (
              <>
                <p>Counted: {formatCentavos(count.countedCentavos)} — waiting on reveal.</p>
                {isSupervisor ? (
                  <>
                    <label>
                      Expected total from POS report (₱)
                      <input value={expectedInput} onChange={(e) => setExpectedInput(e.target.value)} inputMode="decimal" />
                    </label>
                    <button type="button" onClick={handleReveal} disabled={busy}>
                      Reveal and compute variance
                    </button>
                  </>
                ) : (
                  <p className="dialog__hint">A shift leader or above reveals the expected figure.</p>
                )}
              </>
            )}

            {count && count.status === 'revealed' && (
              <>
                <p>Counted: {formatCentavos(count.countedCentavos)}</p>
                <p>Expected: {count.expectedCentavos !== null ? formatCentavos(count.expectedCentavos) : '—'}</p>
                <p>
                  Variance: {count.varianceCentavos !== null ? formatCentavos(count.varianceCentavos) : '—'}
                  {count.requiresInvestigation && ' — requires investigation'}
                </p>
                {count.requiresInvestigation && (
                  <p>
                    Investigation note:{' '}
                    {count.investigationNote ? count.investigationNote : 'awaiting a note from a shift leader or above.'}
                  </p>
                )}
                <div>
                  <button type="button" onClick={handleCloseSession} disabled={busy || !canClose}>
                    Close session
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {error && <p className="dialog__error">{error}</p>}

      {isSupervisor && pendingReveals.filter((c) => c.sessionId !== session?.id).length > 0 && (
        <section className="card">
          <h2>Pending reveals</h2>
          <ul>
            {pendingReveals
              .filter((c) => c.sessionId !== session?.id)
              .map((c) => (
                <PendingRevealRow
                  key={c.id}
                  count={c}
                  onReveal={attemptReveal}
                  onSaveNote={(target, note) => actions.setInvestigationNote(target.id, note)}
                />
              ))}
          </ul>
        </section>
      )}

      {isManager && pendingDropReceipts.filter((d) => d.sessionId !== session?.id).length > 0 && (
        <section className="card">
          <h2>Pending drop receipts</h2>
          <ul>
            {pendingDropReceipts
              .filter((d) => d.sessionId !== session?.id)
              .map((d) => (
                <PendingDropReceiptRow key={d.id} drop={d} onConfirm={handleConfirmReceipt} busy={busy} />
              ))}
          </ul>
        </section>
      )}

      <p>
        <Link to="/cash/exceptions">Void / refund / override / no-sale log</Link>
      </p>
    </div>
  )
}
