// docs/19-M14-PURCHASE-ORDERS.md §2 — two entry points, same form: from an
// approved not-yet-linked request (pre-fills item + quantity, cost left
// blank), or blank. Only ever used while creating, or while an existing
// order is still 'draft' — firestore.rules rejects an edit past that.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { itemsCol, purchaseRequestsCol, suppliersCol } from '@/lib/firebase'
import { usePurchaseOrderActions, updateDraftPurchaseOrder } from '@/lib/purchaseOrders'
import { formatCentavos } from '@/lib/format'
import type { ItemDoc, PurchaseOrder, PurchaseOrderLine, PurchaseRequest, Supplier } from '@/lib/types'

type LineDraft = { itemId: string; qty: string; unitCost: string }

function emptyLine(): LineDraft {
  return { itemId: '', qty: '', unitCost: '' }
}

type Props = {
  existing?: (PurchaseOrder & { id: string }) | null
  onClose: () => void
}

export function PurchaseOrderFormDialog({ existing, onClose }: Props) {
  const { createPurchaseOrder } = usePurchaseOrderActions()
  const [suppliers, setSuppliers] = useState<(Supplier & { id: string })[]>([])
  const [items, setItems] = useState<(ItemDoc & { id: string })[]>([])
  const [pendingRequests, setPendingRequests] = useState<(PurchaseRequest & { id: string })[]>([])

  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? '')
  const [sourceRequestId, setSourceRequestId] = useState('')
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(existing?.expectedDeliveryDate ?? '')
  const [lines, setLines] = useState<LineDraft[]>(
    existing ? existing.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qtyOrdered), unitCost: String(l.unitCostCentavos / 100) })) : [emptyLine()],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return onSnapshot(suppliersCol, (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  // Only relevant when creating fresh — an existing draft was either
  // already linked to a request or started standalone; that choice doesn't
  // change on edit.
  useEffect(() => {
    if (existing) return
    const q = query(purchaseRequestsCol, where('status', '==', 'approved'))
    return onSnapshot(q, (snap) =>
      setPendingRequests(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => !r.linkedPurchaseOrderId),
      ),
    )
  }, [existing])

  const activeSuppliers = [...suppliers].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name))

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function pickSourceRequest(id: string) {
    setSourceRequestId(id)
    const request = pendingRequests.find((r) => r.id === id)
    if (request) {
      setLines(request.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitCost: '' })))
    }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitCost) || 0) * 100, 0)

  async function submit() {
    if (!supplierId) {
      setError('A supplier is required.')
      return
    }
    if (lines.some((l) => !l.itemId || !(Number(l.qty) > 0) || Number(l.unitCost) < 0 || l.unitCost.trim() === '')) {
      setError('Every line needs a real item, a positive quantity, and a unit cost.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const supplier = suppliers.find((s) => s.id === supplierId)
      const poLines: PurchaseOrderLine[] = lines.map((l) => {
        const item = items.find((i) => i.id === l.itemId)
        return {
          itemId: l.itemId,
          itemName: item?.name ?? l.itemId,
          qtyOrdered: Number(l.qty),
          unitCostCentavos: Math.round(Number(l.unitCost) * 100),
          // A PO can only be edited while still 'draft' (firestore.rules),
          // and receiving only ever happens against a sent-or-later PO — so
          // this is always 0 here, whether creating fresh or re-saving an
          // in-progress draft (docs/20-M15-RECEIVING-THREE-WAY-MATCH.md).
          qtyReceivedSoFar: 0,
        }
      })

      if (existing) {
        await updateDraftPurchaseOrder(existing.id, {
          supplierId,
          supplierName: supplier?.name ?? existing.supplierName,
          lines: poLines,
          expectedDeliveryDate: expectedDeliveryDate || null,
        })
      } else {
        await createPurchaseOrder({
          supplierId,
          supplierName: supplier?.name ?? '',
          lines: poLines,
          sourcePurchaseRequestId: sourceRequestId || null,
          expectedDeliveryDate: expectedDeliveryDate || null,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this order.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{existing ? 'Edit purchase order' : 'New purchase order'}</h3>

        {!existing && pendingRequests.length > 0 && (
          <label>
            From an approved request (optional)
            <select value={sourceRequestId} onChange={(e) => (e.target.value ? pickSourceRequest(e.target.value) : setSourceRequestId(''))}>
              <option value="">Standalone — start blank</option>
              {pendingRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.userName} — needed by {r.neededBy}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select a supplier…</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Expected delivery date (optional)
          <input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} />
        </label>

        <p className="dialog__hint">Lines</p>
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
            <input value={line.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} placeholder="Unit cost ₱" />
          </div>
        ))}
        <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          Add line
        </button>

        <p className="dialog__hint">Total: {formatCentavos(total)}</p>

        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
