// docs/19-M14-PURCHASE-ORDERS.md §1 — lines, status, and (manager only)
// the controls to advance status forward or cancel. The lifecycle only
// ever moves forward — firestore.rules rejects anything else, this page
// just doesn't offer a button for a transition that isn't valid right now.
// docs/20-M15-RECEIVING-THREE-WAY-MATCH.md — 'partially_received' and
// 'received' are no longer manual buttons at all: only a real delivery,
// via onReceivingRecordCreated, can move a PO into either state now.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { purchaseOrdersCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { advancePurchaseOrderStatus, cancelPurchaseOrder } from '@/lib/purchaseOrders'
import { formatCentavos } from '@/lib/format'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types'
import { PurchaseOrderFormDialog } from './PurchaseOrderFormDialog'

// The one place this forward-only sequence is spelled out for the UI —
// firestore.rules' isValidPoStatusTransition is the actual enforcement.
// 'partially_received' and 'received' are deliberately absent — see the
// M15 note above.
const NEXT_STATUS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus>> = {
  draft: 'sent',
  sent: 'confirmed',
}

const CANCELLABLE_FROM: PurchaseOrderStatus[] = ['draft', 'sent', 'confirmed']

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  const [po, setPo] = useState<(PurchaseOrder & { id: string }) | null>(null)
  const [editing, setEditing] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(purchaseOrdersCol, id), (snap) => {
      const data = snap.data()
      setPo(data ? { id, ...data } : null)
    })
  }, [id])

  async function advance() {
    if (!po) return
    const next = NEXT_STATUS[po.status]
    if (!next) return
    setBusy(true)
    setError(null)
    try {
      await advancePurchaseOrderStatus(po.id, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this order.')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!po) return
    if (!cancelReason.trim()) {
      setError('A reason is required to cancel.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await cancelPurchaseOrder(po.id, cancelReason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this order.')
    } finally {
      setBusy(false)
    }
  }

  if (!po) return <p>Loading…</p>

  const next = NEXT_STATUS[po.status]
  const canCancel = CANCELLABLE_FROM.includes(po.status)

  return (
    <div className="purchase-order-detail-page">
      <h2>{po.supplierName}</h2>
      <p>
        Status: <span className={`status-pill status-pill--${po.status}`}>{po.status.replace('_', ' ')}</span> — Total:{' '}
        {formatCentavos(po.totalCentavos)}
        {po.expectedDeliveryDate && ` — Expected ${po.expectedDeliveryDate}`}
      </p>
      {po.status === 'cancelled' && po.cancelledReason && <p className="dialog__error">Cancelled: {po.cancelledReason}</p>}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Received</th>
              <th>Unit cost</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.itemName}</td>
                <td>{l.qtyOrdered}</td>
                <td>{l.qtyReceivedSoFar} / {l.qtyOrdered}</td>
                <td>{formatCentavos(l.unitCostCentavos)}</td>
                <td>{formatCentavos(l.qtyOrdered * l.unitCostCentavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isManager && (po.status === 'draft' || next || canCancel) && (
        <section className="card">
          <h2>Manage this order</h2>
          {error && <p className="dialog__error">{error}</p>}
          <div className="dialog__actions">
            {po.status === 'draft' && (
              <button type="button" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {next && (
              <button type="button" onClick={advance} disabled={busy}>
                {busy ? 'Updating…' : `Mark ${next.replace('_', ' ')}`}
              </button>
            )}
          </div>
          {canCancel && (
            <>
              <label>
                Cancel reason
                <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </label>
              <button type="button" onClick={cancel} disabled={busy}>
                Cancel order
              </button>
            </>
          )}
        </section>
      )}

      {editing && <PurchaseOrderFormDialog existing={po} onClose={() => setEditing(false)} />}
    </div>
  )
}
