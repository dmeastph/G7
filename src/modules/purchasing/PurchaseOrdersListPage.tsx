// docs/19-M14-PURCHASE-ORDERS.md §1 — every PO with status and total; a
// manager sees "New purchase order", everyone else reads only (M15 will
// need a station account preparing to receive a delivery to see this).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { purchaseOrdersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { formatCentavos } from '@/lib/format'
import type { PurchaseOrder } from '@/lib/types'
import { PurchaseOrderFormDialog } from './PurchaseOrderFormDialog'

type Row = PurchaseOrder & { id: string }

export function PurchaseOrdersListPage() {
  const auth = useAuth()
  const activeBranch = useActiveBranch()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [rows, setRows] = useState<Row[]>([])
  const [creating, setCreating] = useState(false)

  // purchaseOrders' own rule requires sameBranch(resource.data.branchId) —
  // this was an unfiltered onSnapshot on the whole collection, which
  // Firestore rejects outright for the same reason as the other three
  // fixes in this batch. Confirmed live: neither a newly created PO nor a
  // deletion ever reflected here, even surviving a hard refresh, because
  // the listener never had a working subscription in the first place.
  useEffect(() => {
    if (!activeBranch) return
    const q = query(purchaseOrdersCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const sorted = [...rows].sort((a, b) => b.id.localeCompare(a.id))

  return (
    <div className="purchase-orders-page">
      <div className="page-header">
        <h2>Purchase orders</h2>
        {isManager && (
          <button type="button" onClick={() => setCreating(true)}>
            New purchase order
          </button>
        )}
      </div>

      {sorted.length === 0 && <p className="empty-state">No purchase orders yet.</p>}

      {sorted.length > 0 && (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((po) => (
                <tr key={po.id}>
                  <td>{po.supplierName}</td>
                  <td>{po.status.replace('_', ' ')}</td>
                  <td>{po.lines.length}</td>
                  <td>{formatCentavos(po.totalCentavos)}</td>
                  <td>
                    <Link to={`/purchasing/orders/${po.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {creating && <PurchaseOrderFormDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
