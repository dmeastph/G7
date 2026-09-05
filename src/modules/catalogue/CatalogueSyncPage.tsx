// docs/15-M10-ITEM-MASTER.md — item master bridge. Synced fields (name,
// SKU, category, price, VAT class) come from g7-pos and are read-only
// here; operational fields (reorder point, unit of purchase) are g7-ops's
// own and editable by a manager. "Sync now" runs the identical logic the
// handover trigger runs automatically — for a manager who doesn't want to
// wait for the next shift change.
import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query, limit as fsLimit, type Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { itemsCol, catalogueSyncsCol, functions } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { formatCentavos, toMillisSafe } from '@/lib/format'
import type { ItemDoc, CatalogueSyncDoc } from '@/lib/types'
import { ItemOperationalFieldsDialog } from './ItemOperationalFieldsDialog'

type ItemRow = ItemDoc & { id: string }
type SyncRow = CatalogueSyncDoc & { id: string }

function formatWhen(ts: Timestamp | null | undefined): string {
  return new Date(toMillisSafe(ts)).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function CatalogueSyncPage() {
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [items, setItems] = useState<ItemRow[]>([])
  const [syncs, setSyncs] = useState<SyncRow[]>([])
  const [editing, setEditing] = useState<ItemRow | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return onSnapshot(itemsCol, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  useEffect(() => {
    if (!isManager) return
    const q = query(catalogueSyncsCol, orderBy('createdAt', 'desc'), fsLimit(10))
    return onSnapshot(q, (snap) => setSyncs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [isManager])

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view the catalogue.</p>
      </div>
    )
  }

  async function syncNow() {
    setSyncing(true)
    setError(null)
    try {
      const call = httpsCallable(functions, 'syncCatalogueNow')
      await call()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run the sync.')
    } finally {
      setSyncing(false)
    }
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="catalogue-page">
      <div className="page-header">
        <h2>Catalogue</h2>
        <button type="button" onClick={syncNow} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {error && <p className="dialog__error">{error}</p>}

      {sorted.length === 0 && <p className="empty-state">No items yet — run a sync, or wait for the next handover.</p>}

      {sorted.length > 0 && (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Price</th>
                <th>Reorder point</th>
                <th>Unit of purchase</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    {!item.presentInLatestExport && <span className="catalogue-page__missing-badge">missing from g7-pos</span>}
                  </td>
                  <td>{item.sku}</td>
                  <td>{item.category}</td>
                  <td>{formatCentavos(item.priceCentavos)}</td>
                  <td className={item.reorderPoint === null ? 'param-value--unset' : ''}>{item.reorderPoint ?? 'not set'}</td>
                  <td className={item.unitOfPurchase === null ? 'param-value--unset' : ''}>{item.unitOfPurchase ?? 'not set'}</td>
                  <td>
                    <button type="button" onClick={() => setEditing(item)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Sync history</h2>
        {syncs.length === 0 && <p className="empty-state">No syncs recorded yet.</p>}
        {syncs.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Trigger</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {syncs.map((s) => (
                <tr key={s.id}>
                  <td>{formatWhen(s.createdAt)}</td>
                  <td>{s.trigger === 'handover' ? 'Shift handover' : 'Manual'}</td>
                  <td>
                    {s.status === 'failed' ? (
                      <span className="dialog__error">Failed — {s.errorMessage}</span>
                    ) : (
                      `${s.newCount} new, ${s.changedCount} changed, ${s.missingCount} missing`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && <ItemOperationalFieldsDialog item={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
