// docs/07-M2-CHECKLISTS.md §6 — supplier, ordered vs received qty and
// condition per line, optional temperature check, discrepancy note.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { receivingRecordsCol, suppliersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useWriteOperational } from '@/lib/write'
import { toMillisSafe } from '@/lib/format'
import type { ReceivingItem, ReceivingRecord, Supplier } from '@/lib/types'

type Row = ReceivingRecord & { id: string }
type SupplierRow = Supplier & { id: string }

function emptyItem(): ReceivingItem {
  return { name: '', qtyOrdered: 0, qtyReceived: 0, condition: 'ok' }
}

export function ReceivingLogPage() {
  const activeBranch = useActiveBranch()
  const { write } = useWriteOperational()
  const [rows, setRows] = useState<Row[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [supplier, setSupplier] = useState('')
  const [deliveryRef, setDeliveryRef] = useState('')
  const [items, setItems] = useState<ReceivingItem[]>([emptyItem()])
  const [temperatureCheckC, setTemperatureCheckC] = useState('')
  const [discrepancyNote, setDiscrepancyNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(receivingRecordsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  // suppliers (M12) has no branchId — one shared list, same as items (M10).
  useEffect(() => {
    return onSnapshot(suppliersCol, (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  const activeSuppliers = [...suppliers].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))

  // Picking a real supplier locks the free-text field to it — a linked
  // receiving record shouldn't drift from the supplier's own name.
  function pickSupplier(id: string) {
    setSupplierId(id)
    const picked = suppliers.find((s) => s.id === id)
    if (picked) setSupplier(picked.name)
  }

  function updateItem(index: number, patch: Partial<ReceivingItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  const discrepancyNoted = items.some((it) => it.condition !== 'ok' || it.qtyOrdered !== it.qtyReceived)

  async function submit() {
    if (!supplier.trim()) {
      setError('Supplier is required.')
      return
    }
    if (items.some((it) => !it.name.trim())) {
      setError('Every line needs an item name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('receivingRecords', {
        supplierId: supplierId || null,
        supplier: supplier.trim(),
        deliveryRef: deliveryRef.trim(),
        items,
        temperatureCheckC: temperatureCheckC.trim() === '' ? null : Number(temperatureCheckC),
        discrepancyNoted,
        discrepancyNote: discrepancyNoted ? discrepancyNote.trim() : '',
      })
      setSupplierId('')
      setSupplier('')
      setDeliveryRef('')
      setItems([emptyItem()])
      setTemperatureCheckC('')
      setDiscrepancyNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this delivery.')
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))

  return (
    <div className="receiving-page">
      <h2>Receiving</h2>
      <section className="card">
        <label>
          Supplier (pick a real supplier to link this record, optional)
          <select
            value={supplierId}
            onChange={(e) => {
              if (e.target.value) pickSupplier(e.target.value)
              else {
                setSupplierId('')
                setSupplier('')
              }
            }}
          >
            <option value="">Type a name instead…</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {!supplierId && (
          <label>
            Supplier name
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </label>
        )}
        <label>
          Delivery reference
          <input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} />
        </label>

        <p className="dialog__hint">Items</p>
        {items.map((item, i) => (
          <div key={i} className="template-item-row">
            <input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="Item" />
            <input
              value={item.qtyOrdered}
              onChange={(e) => updateItem(i, { qtyOrdered: Number(e.target.value) || 0 })}
              placeholder="Ordered"
            />
            <input
              value={item.qtyReceived}
              onChange={(e) => updateItem(i, { qtyReceived: Number(e.target.value) || 0 })}
              placeholder="Received"
            />
            <select value={item.condition} onChange={(e) => updateItem(i, { condition: e.target.value as ReceivingItem['condition'] })}>
              <option value="ok">ok</option>
              <option value="damaged">damaged</option>
              <option value="short">short</option>
              <option value="wrong_item">wrong item</option>
            </select>
          </div>
        ))}
        <button type="button" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          Add line
        </button>

        <label>
          Temperature check °C (optional)
          <input value={temperatureCheckC} onChange={(e) => setTemperatureCheckC(e.target.value)} />
        </label>
        {discrepancyNoted && (
          <label>
            Discrepancy note
            <input value={discrepancyNote} onChange={(e) => setDiscrepancyNote(e.target.value)} />
          </label>
        )}
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Recording…' : 'Record delivery'}
        </button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {sorted.length === 0 && <p className="empty-state">Nothing recorded yet.</p>}
        <ul>
          {sorted.map((r) => (
            <li key={r.id}>
              {r.supplier} — {r.items.length} line{r.items.length === 1 ? '' : 's'}
              {r.discrepancyNoted && ' — discrepancy noted'}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
