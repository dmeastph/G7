// docs/04-M1-COLDCHAIN.md §3. The setpoint warning must be visible without
// scrolling — it sits right under the header, always, while open.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot, query, where } from 'firebase/firestore'
import { equipmentCol, excursionsCol, quarantineLotsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { formatTimeManila, toMillisSafe } from '@/lib/format'
import { shouldAutoQuarantine, EMPTY_FIRST_CHECKS } from '@/lib/coldchain'
import { useColdChainActions } from './actions'
import { QuarantineLotDialog } from './QuarantineLotDialog'
import { TicketFormDialog } from './TicketFormDialog'
import type { Equipment, Excursion, ExcursionFirstChecks, QuarantineLot } from '@/lib/types'

function elapsedText(startedAt: Excursion['startedAt'], now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - toMillisSafe(startedAt)) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function ExcursionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const activeBranch = useActiveBranch()
  const { saveFirstChecks, closeExcursion, escalateToQuarantine } = useColdChainActions()

  const [excursion, setExcursion] = useState<Excursion | null>(null)
  const [equipment, setEquipment] = useState<(Equipment & { id: string }) | null>(null)
  const [lots, setLots] = useState<(QuarantineLot & { id: string })[]>([])
  const [checks, setChecks] = useState<ExcursionFirstChecks>(EMPTY_FIRST_CHECKS)
  const [closureNote, setClosureNote] = useState('')
  const [now, setNow] = useState(new Date())
  const [busy, setBusy] = useState(false)
  const [showQuarantineDialog, setShowQuarantineDialog] = useState(false)
  const [showTicketDialog, setShowTicketDialog] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(excursionsCol, id), (snap) => {
      const data = snap.data() ?? null
      setExcursion(data)
      if (data?.firstChecks) setChecks(data.firstChecks)
    })
  }, [id])

  useEffect(() => {
    if (!excursion) return
    return onSnapshot(doc(equipmentCol, excursion.equipmentId), (snap) => {
      const data = snap.data()
      setEquipment(data ? { id: excursion.equipmentId, ...data } : null)
    })
  }, [excursion])

  useEffect(() => {
    // branchId must be a filter here, not just true of the data — Firestore
    // can't evaluate a list rule's sameBranch(resource.data.branchId) per
    // document, only prove it from the query shape itself. Omitting this
    // filter denies the whole query outright (a real bug this caught).
    if (!id || !activeBranch) return
    const q = query(
      quarantineLotsCol,
      where('branchId', '==', activeBranch.branchId),
      where('excursionId', '==', id),
    )
    return onSnapshot(q, (snap) => setLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [id, activeBranch])

  const maxExcursionMinutes = equipment?.thresholds?.maxExcursionMinutes ?? null
  const elapsedMinutes = excursion ? Math.round((now.getTime() - toMillisSafe(excursion.startedAt)) / 60_000) : 0

  // Auto-quarantine: client-side check while this page is open, since M1
  // has no scheduled Cloud Function yet — "server-side re-evaluation on
  // sync catches anything missed" covers the rest (docs/04-M1-COLDCHAIN.md).
  useEffect(() => {
    if (!excursion || !id || excursion.status !== 'open') return
    if (!shouldAutoQuarantine(elapsedMinutes, maxExcursionMinutes)) return
    escalateToQuarantine(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excursion?.status, elapsedMinutes, maxExcursionMinutes, id])

  if (!excursion || !id) return <p>Loading…</p>

  const needsManualQuarantineDecision = excursion.status === 'open' && maxExcursionMinutes === null && elapsedMinutes > 0

  async function handleSaveChecks() {
    setBusy(true)
    try {
      await saveFirstChecks(id!, checks)
    } finally {
      setBusy(false)
    }
  }

  async function handleClose() {
    if (!closureNote.trim()) return
    setBusy(true)
    try {
      await closeExcursion(id!, closureNote)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="excursion-page">
      <h2>
        {excursion.assetId} — {excursion.status}
      </h2>
      <p>
        Started {formatTimeManila(excursion.startedAt)} · running {elapsedText(excursion.startedAt, now)} · peak{' '}
        {excursion.peakC}°C
      </p>

      <div className="card excursion-page__setpoint-warning">
        <strong>Do not change the setpoint.</strong> That is not a fix — it is a decision to sell warm stock.
      </div>

      {needsManualQuarantineDecision && (
        <div className="card dialog__warning">
          <p>
            No maximum excursion time is set for this unit — auto-quarantine will not fire. Shift Leader: decide now
            whether to quarantine the stock.
          </p>
          <button type="button" onClick={() => escalateToQuarantine(id)} disabled={busy}>
            Quarantine now
          </button>
        </div>
      )}

      <section className="card">
        <h2>First checks</h2>
        {(
          [
            ['doorOpen', 'Door open'],
            ['overloaded', 'Overloaded or blocked'],
            ['iceBuildup', 'Ice build-up'],
            ['defrostCycle', 'Defrost cycle'],
            ['powerInterruption', 'Power interruption'],
            ['gasketDamaged', 'Gasket damaged'],
            ['setpointChanged', 'Setpoint changed'],
            ['nothingFound', 'Nothing found'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="dialog__checkbox">
            <input
              type="checkbox"
              checked={checks[key]}
              onChange={(e) => setChecks((c) => ({ ...c, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
        <label>
          Detail
          <input value={checks.detail} onChange={(e) => setChecks((c) => ({ ...c, detail: e.target.value }))} />
        </label>
        <button type="button" onClick={handleSaveChecks} disabled={busy}>
          Save checks
        </button>
      </section>

      <section className="card">
        <h2>Quarantine</h2>
        {lots.length === 0 && <p className="empty-state">No lots quarantined for this excursion.</p>}
        <ul>
          {lots.map((l) => (
            <li key={l.id}>
              {l.itemName} × {l.qty} {l.unit} — {l.status}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setShowQuarantineDialog(true)}>
          Quarantine a lot
        </button>
      </section>

      <section className="card">
        <h2>Maintenance</h2>
        <button type="button" onClick={() => setShowTicketDialog(true)}>
          Raise ticket
        </button>
        {excursion.ticketId && <p>Linked ticket: {excursion.ticketId}</p>}
      </section>

      {(excursion.status === 'recovered' || excursion.status === 'quarantined') && (
        <section className="card">
          <h2>Close excursion</h2>
          <label>
            Cause and action taken
            <input value={closureNote} onChange={(e) => setClosureNote(e.target.value)} required />
          </label>
          <button type="button" onClick={handleClose} disabled={busy || !closureNote.trim()}>
            Close
          </button>
        </section>
      )}

      {showQuarantineDialog && equipment && (
        <QuarantineLotDialog
          excursionId={id}
          equipment={equipment}
          onClose={() => setShowQuarantineDialog(false)}
        />
      )}
      {showTicketDialog && equipment && (
        <TicketFormDialog
          equipment={equipment}
          excursionId={id}
          onClose={() => setShowTicketDialog(false)}
        />
      )}
    </div>
  )
}
