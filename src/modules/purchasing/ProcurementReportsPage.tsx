// docs/21-M16-PROCUREMENT-REPORTS.md — one page, a tab row, one table per
// tab, mirroring g7-pos/src/modules/reports/ReportsPage.tsx's own
// DimensionTabs shape. Every dimension is a pure function from
// lib/procurementReports.ts — this component only subscribes and renders.
import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { itemsCol, purchaseOrdersCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { formatCentavos } from '@/lib/format'
import {
  computeLowStockItems,
  computeOnTimeDelivery,
  computeOpenOrderAging,
  computeSpend,
} from '@/lib/procurementReports'
import type { ItemDoc, PurchaseOrder } from '@/lib/types'

type Dimension = 'open' | 'spend' | 'onTime' | 'lowStock'

const TABS: { key: Dimension; label: string }[] = [
  { key: 'open', label: 'Open orders' },
  { key: 'spend', label: 'Spend' },
  { key: 'onTime', label: 'On-time delivery' },
  { key: 'lowStock', label: 'Low stock' },
]

export function ProcurementReportsPage() {
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [dimension, setDimension] = useState<Dimension>('open')
  const [orders, setOrders] = useState<(PurchaseOrder & { id: string })[]>([])
  const [items, setItems] = useState<(ItemDoc & { id: string })[]>([])

  useEffect(() => {
    return onSnapshot(purchaseOrdersCol, (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view reports.</p>
      </div>
    )
  }

  const aging = computeOpenOrderAging(orders)
  const spend = computeSpend(orders, items)
  const onTime = computeOnTimeDelivery(orders)
  const lowStock = computeLowStockItems(items)

  return (
    <div className="reports-page">
      <h2>Reports</h2>
      <div className="reports-page__tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={dimension === t.key ? 'reports-page__tab reports-page__tab--active' : 'reports-page__tab'}
            onClick={() => setDimension(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {dimension === 'open' && (
        <section className="card">
          {aging.length === 0 && <p className="empty-state">No open orders.</p>}
          {aging.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Days open</th>
                  <th>Bucket</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((row) => (
                  <tr key={row.poId}>
                    <td>{row.supplierName}</td>
                    <td>{row.status.replace('_', ' ')}</td>
                    <td>{row.daysOpen}</td>
                    <td>{row.bucket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {dimension === 'spend' && (
        <>
          <section className="card">
            <h2>By supplier</h2>
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {spend.bySupplier.map((row) => (
                  <tr key={row.supplierName}>
                    <td>{row.supplierName}</td>
                    <td>{formatCentavos(row.totalCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>By category</h2>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {spend.byCategory.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category}</td>
                    <td>{formatCentavos(row.totalCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>By month</h2>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {spend.byMonth.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{formatCentavos(row.totalCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="dialog__hint">Total committed spend: {formatCentavos(spend.grandTotalCentavos)}</p>
        </>
      )}

      {dimension === 'onTime' && (
        <section className="card">
          {onTime.length === 0 && <p className="empty-state">No completed orders with both an expected and actual delivery date yet.</p>}
          {onTime.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>On time</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {onTime.map((row) => (
                  <tr key={row.supplierName}>
                    <td>{row.supplierName}</td>
                    <td>
                      {row.onTimeCount} / {row.totalCount}
                    </td>
                    <td>{row.onTimePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {dimension === 'lowStock' && (
        <section className="card">
          {lowStock.length === 0 && <p className="empty-state">Nothing to reorder right now.</p>}
          {lowStock.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>On hand</th>
                  <th>Reorder point</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.qtyOnHand}</td>
                    <td>{row.reorderPoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
