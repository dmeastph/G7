// docs/16-M11-INVENTORY.md §1 — stock-on-hand per item, low-stock marker,
// and per-item movement history. reorderPoint itself stays editable on the
// Catalogue screen (M10) — one field, one place to edit it.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where, orderBy, limit as fsLimit } from 'firebase/firestore'
import { itemsCol, inventoryMovementsCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { toMillisSafe } from '@/lib/format'
import type { ItemDoc, InventoryMovement } from '@/lib/types'

type ItemRow = ItemDoc & { id: string }
type MovementRow = InventoryMovement & { id: string }

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function InventoryPage() {
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [items, setItems] = useState<ItemRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [movements, setMovements] = useState<MovementRow[]>([])

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setMovements([])
      return
    }
    const q = query(inventoryMovementsCol, where('itemId', '==', selectedId), orderBy('createdAt', 'desc'), fsLimit(20))
    return onSnapshot(q, (snap) => setMovements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [selectedId])

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view inventory.</p>
      </div>
    )
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const selected = items.find((i) => i.id === selectedId) ?? null

  return (
    <div className="inventory-page">
      <h2>Inventory</h2>

      {sorted.length === 0 && <p className="empty-state">No items yet — sync the catalogue first.</p>}

      {sorted.length > 0 && (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>On hand</th>
                <th>Reorder point</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const low = item.reorderPoint !== null && item.qtyOnHand <= item.reorderPoint
                return (
                  <tr key={item.id} className={low ? 'inventory-page__row--low' : ''}>
                    <td>
                      {item.name}
                      {low && <span className="catalogue-page__missing-badge">low stock</span>}
                    </td>
                    <td>{item.sku}</td>
                    <td>{item.qtyOnHand}</td>
                    <td className={item.reorderPoint === null ? 'param-value--unset' : ''}>{item.reorderPoint ?? 'not set'}</td>
                    <td>
                      <button type="button" onClick={() => setSelectedId(item.id)}>
                        View movements
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {selected && (
        <section className="card">
          <h2>Movement history — {selected.name}</h2>
          <button type="button" onClick={() => setSelectedId(null)}>
            Close
          </button>
          {movements.length === 0 && <p className="empty-state">No movements recorded for this item yet.</p>}
          {movements.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{formatWhen(toMillisSafe(m.createdAt))}</td>
                    <td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    <td>{m.reason.replace('_', ' ')}</td>
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
