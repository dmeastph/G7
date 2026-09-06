// docs/16-M11-INVENTORY.md §3 — stock leaving for a reason that isn't
// wastage and isn't a sale (staff meals, samples, internal use). Always
// requires a real item, unlike wastage's optional link — there's no
// legacy free-text behavior to preserve here.
import { useEffect, useState } from 'react'
import { onSnapshot, query, orderBy, limit as fsLimit } from 'firebase/firestore'
import { itemsCol, consumptionEntriesCol } from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import { toMillisSafe } from '@/lib/format'
import type { ItemDoc, ConsumptionEntry } from '@/lib/types'

type ItemRow = ItemDoc & { id: string }
type Row = ConsumptionEntry & { id: string }

export function LogConsumptionPage() {
  const { write } = useWriteOperational()
  const [items, setItems] = useState<ItemRow[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    const q = query(consumptionEntriesCol, orderBy('createdAt', 'desc'), fsLimit(20))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const itemById = new Map(items.map((i) => [i.id, i]))

  async function submit() {
    if (!itemId) {
      setError('Pick an item.')
      return
    }
    const qtyNum = Number(qty)
    if (!qty.trim() || !(qtyNum > 0)) {
      setError('Quantity must be a positive number.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('consumptionEntries', { itemId, qty: qtyNum, reason: reason.trim() })
      setItemId('')
      setQty('')
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this.')
    } finally {
      setBusy(false)
    }
  }

  const sortedRows = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))

  return (
    <div className="consumption-page">
      <h2>Log consumption</h2>
      <section className="card">
        <label>
          Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Select an item…</option>
            {sortedItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. staff meal, sample" />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Recording…' : 'Record consumption'}
        </button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {sortedRows.length === 0 && <p className="empty-state">Nothing recorded yet.</p>}
        {sortedRows.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id}>
                  <td>{itemById.get(r.itemId)?.name ?? r.itemId}</td>
                  <td>{r.qty}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
