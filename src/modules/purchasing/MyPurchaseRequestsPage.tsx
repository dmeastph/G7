// docs/18-M13-PURCHASE-REQUESTS.md §1 — submit against real catalogue
// items, see own request history and its status.
import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { itemsCol, purchaseRequestsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useWriteOperational } from '@/lib/write'
import { toMillisSafe } from '@/lib/format'
import type { ItemDoc, PurchaseRequest, PurchaseRequestLine } from '@/lib/types'

type Row = PurchaseRequest & { id: string }
type ItemRow = ItemDoc & { id: string }
type LineDraft = { itemId: string; qty: string; unit: string }

function emptyLine(): LineDraft {
  return { itemId: '', qty: '', unit: '' }
}

export function MyPurchaseRequestsPage() {
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { write } = useWriteOperational()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [rows, setRows] = useState<Row[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch || !who) return
    const q = query(
      purchaseRequestsCol,
      where('branchId', '==', activeBranch.branchId),
      where('userId', '==', who.userId),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, who?.userId])

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name))

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  async function submit() {
    if (!who) return
    if (!neededBy) {
      setError('A needed-by date is required.')
      return
    }
    if (lines.some((l) => !l.itemId || !l.qty.trim() || Number(l.qty) <= 0)) {
      setError('Every line needs a real item and a positive quantity.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const requestLines: PurchaseRequestLine[] = lines.map((l) => {
        const item = items.find((i) => i.id === l.itemId)
        return { itemId: l.itemId, itemName: item?.name ?? l.itemId, qty: Number(l.qty), unit: l.unit.trim() }
      })
      await write('purchaseRequests', {
        userId: who.userId,
        userName: who.userName,
        lines: requestLines,
        neededBy,
        note: note.trim(),
        status: 'pending',
        decidedBy: null,
        decidedByName: null,
        decidedAt: null,
        decisionNote: '',
      })
      setLines([emptyLine()])
      setNeededBy('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit this request.')
    } finally {
      setBusy(false)
    }
  }

  if (!who) return <p>Sign in to submit a purchase request.</p>

  const sortedRows = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))

  return (
    <div className="purchase-requests-page">
      <h2>Purchase requests</h2>
      <section className="card">
        <h2>New request</h2>
        <p className="dialog__hint">Items</p>
        {lines.map((line, i) => (
          <div key={i} className="template-item-row">
            <select value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })}>
              <option value="">Select an item…</option>
              {sortedItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <input value={line.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} placeholder="Qty" />
            <input value={line.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} placeholder="Unit (e.g. cases)" />
          </div>
        ))}
        <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          Add line
        </button>

        <label>
          Needed by
          <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </section>

      <section className="card">
        <h2>My requests</h2>
        {sortedRows.length === 0 && <p className="empty-state">No requests yet.</p>}
        <ul>
          {sortedRows.map((r) => (
            <li key={r.id}>
              {r.lines.map((l) => `${l.qty} ${l.unit} ${l.itemName}`).join(', ')} — needed by {r.neededBy} — {r.status}
              {r.status !== 'pending' && r.decisionNote && ` — ${r.decisionNote}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
