// Only the three operational fields are editable here — sourceItemId, sku,
// name, category, priceCentavos, vatClass all come from g7-pos and would
// just be overwritten by the next sync if edited (docs/15-M10-ITEM-MASTER.md
// "g7-ops's copy is for what an item *does* operationally"). firestore.rules
// enforces this too: the update rule on items/{id} only allows these three
// keys to change.
import { useEffect, useState } from 'react'
import { updateDoc, doc, onSnapshot } from 'firebase/firestore'
import { itemsCol, suppliersCol } from '@/lib/firebase'
import type { ItemDoc, Supplier } from '@/lib/types'

type Props = {
  item: ItemDoc & { id: string }
  onClose: () => void
}

export function ItemOperationalFieldsDialog({ item, onClose }: Props) {
  const [reorderPoint, setReorderPoint] = useState(item.reorderPoint !== null ? String(item.reorderPoint) : '')
  const [unitOfPurchase, setUnitOfPurchase] = useState(item.unitOfPurchase ?? '')
  const [defaultSupplierId, setDefaultSupplierId] = useState(item.defaultSupplierId ?? '')
  const [suppliers, setSuppliers] = useState<(Supplier & { id: string })[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return onSnapshot(suppliersCol, (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  const activeSuppliers = [...suppliers].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name))

  async function save() {
    if (reorderPoint.trim() !== '' && Number.isNaN(Number(reorderPoint))) {
      setError('Reorder point must be a number, or left blank for "not set".')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(itemsCol, item.id), {
        reorderPoint: reorderPoint.trim() === '' ? null : Number(reorderPoint),
        unitOfPurchase: unitOfPurchase.trim() === '' ? null : unitOfPurchase.trim(),
        defaultSupplierId: defaultSupplierId || null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{item.name}</h3>
        <p className="dialog__hint">
          Name, price, category and VAT class are synced from g7-pos and can't be changed here — edit them in g7-pos's own Items screen.
        </p>
        <label>
          Reorder point
          <input value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} placeholder="not set" />
        </label>
        <label>
          Unit of purchase
          <input value={unitOfPurchase} onChange={(e) => setUnitOfPurchase(e.target.value)} placeholder="e.g. case of 24" />
        </label>
        <label>
          Default supplier
          <select value={defaultSupplierId} onChange={(e) => setDefaultSupplierId(e.target.value)}>
            <option value="">not set</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
