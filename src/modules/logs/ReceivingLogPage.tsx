// docs/07-M2-CHECKLISTS.md §6 — supplier, ordered vs received qty and
// condition per line, optional temperature check, discrepancy note.
// docs/20-M15-RECEIVING-THREE-WAY-MATCH.md — picking a PO awaiting
// delivery locks the supplier and pre-fills lines with a real item and a
// read-only "quantity ordered" (the still-outstanding amount); quantity
// received stays exactly as editable as it's always been. An extra
// free-text line can still be added by hand, exactly as before M15.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { receivingRecordsCol, suppliersCol, purchaseOrdersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useWriteOperational } from '@/lib/write'
import { toMillisSafe } from '@/lib/format'
import type { PurchaseOrder, ReceivingItem, ReceivingRecord, Supplier } from '@/lib/types'

type Row = ReceivingRecord & { id: string }
type SupplierRow = Supplier & { id: string }
type PoRow = PurchaseOrder & { id: string }

function emptyItem(): ReceivingItem {
  return { name: '', qtyOrdered: 0, qtyReceived: 0, condition: 'ok', itemId: null }
}

const AWAITING_DELIVERY = new Set(['sent', 'confirmed', 'partially_received'])

export function ReceivingLogPage() {
  const activeBranch = useActiveBranch()
  const { write } = useWriteOperational()
  const [rows, setRows] = useState<Row[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PoRow[]>([])
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
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

  // suppliers (M12) has no branchId — a shared list, same as items (M10).
  useEffect(() => {
    return onSnapshot(suppliersCol, (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  // purchaseOrders (M14) DOES carry a branchId (it extends OperationalBase)
  // and its own rule requires sameBranch(resource.data.branchId) — this was
  // originally left unfiltered on the mistaken assumption it was shared
  // like suppliers/items; fixed during the M10-M16 system review after
  // confirming live that an unfiltered query here is rejected outright.
  useEffect(() => {
    if (!activeBranch) return
    const q = query(purchaseOrdersCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const activeSuppliers = [...suppliers].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))
  const awaitingDelivery = purchaseOrders.filter((po) => AWAITING_DELIVERY.has(po.status))

  // Picking a real supplier locks the free-text field to it — a linked
  // receiving record shouldn't drift from the supplier's own name.
  function pickSupplier(id: string) {
    setSupplierId(id)
    const picked = suppliers.find((s) => s.id === id)
    if (picked) setSupplier(picked.name)
  }

  // A PO already committed to one supplier — locks the supplier field too,
  // and pre-fills one line per still-outstanding PO line.
  function pickPurchaseOrder(id: string) {
    setPurchaseOrderId(id)
    const po = purchaseOrders.find((p) => p.id === id)
    if (!po) return
    setSupplierId(po.supplierId)
    setSupplier(po.supplierName)
    const outstanding = po.lines
      .filter((l) => l.qtyOrdered - l.qtyReceivedSoFar > 0)
      .map((l) => {
        const remaining = l.qtyOrdered - l.qtyReceivedSoFar
        return { name: l.itemName, qtyOrdered: remaining, qtyReceived: remaining, condition: 'ok' as const, itemId: l.itemId }
      })
    setItems(outstanding.length > 0 ? outstanding : [emptyItem()])
  }

  function clearPurchaseOrder() {
    setPurchaseOrderId('')
    setSupplierId('')
    setSupplier('')
    setItems([emptyItem()])
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
        purchaseOrderId: purchaseOrderId || null,
        supplierId: supplierId || null,
        supplier: supplier.trim(),
        deliveryRef: deliveryRef.trim(),
        items,
        temperatureCheckC: temperatureCheckC.trim() === '' ? null : Number(temperatureCheckC),
        discrepancyNoted,
        discrepancyNote: discrepancyNoted ? discrepancyNote.trim() : '',
      })
      setPurchaseOrderId('')
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
          Receiving against a purchase order (optional)
          <select value={purchaseOrderId} onChange={(e) => (e.target.value ? pickPurchaseOrder(e.target.value) : clearPurchaseOrder())}>
            <option value="">No purchase order</option>
            {awaitingDelivery.map((po) => (
              <option key={po.id} value={po.id}>
                {po.supplierName} — {po.lines.length} line{po.lines.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>

        {purchaseOrderId ? (
          <p className="dialog__hint">Supplier: {supplier} (locked to this purchase order)</p>
        ) : (
          <>
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
          </>
        )}

        <label>
          Delivery reference
          <input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} />
        </label>

        <p className="dialog__hint">Items</p>
        {items.map((item, i) => {
          const locked = !!purchaseOrderId && item.itemId !== null
          return (
            <div key={i} className="template-item-row">
              {locked ? (
                <span>{item.name}</span>
              ) : (
                <input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="Item" />
              )}
              {locked ? (
                <span>{item.qtyOrdered}</span>
              ) : (
                <input
                  value={item.qtyOrdered}
                  onChange={(e) => updateItem(i, { qtyOrdered: Number(e.target.value) || 0 })}
                  placeholder="Ordered"
                />
              )}
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
          )
        })}
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
