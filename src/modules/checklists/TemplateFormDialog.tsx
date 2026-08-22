// docs/07-M2-CHECKLISTS.md §1. Editing creates a new version — the old one
// stays attached to whatever runs already reference it, same reasoning as
// parameters (docs/02-DATA-MODEL.md).
import { useState } from 'react'
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db, checklistTemplatesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import type { ChecklistCategory, ChecklistItem, ChecklistItemType, ChecklistTemplate } from '@/lib/types'

type Props = {
  existing?: (ChecklistTemplate & { id: string }) | null
  defaultCategory?: ChecklistCategory
  onClose: () => void
}

const CATEGORIES: ChecklistCategory[] = ['opening', 'closing', 'ramyeon_station', 'dining', 'general']
const ITEM_TYPES: ChecklistItemType[] = ['pass_fail', 'numeric', 'photo', 'text']

let itemIdCounter = 0
function newItemId() {
  itemIdCounter += 1
  return `item-${Date.now()}-${itemIdCounter}`
}

export function TemplateFormDialog({ existing, defaultCategory, onClose }: Props) {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const [name, setName] = useState(existing?.name ?? '')
  const [category, setCategory] = useState<ChecklistCategory>(existing?.category ?? defaultCategory ?? 'opening')
  const [items, setItems] = useState<ChecklistItem[]>(existing?.items ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: newItemId(), label: '', type: 'pass_fail', required: true, numericMin: null, numericMax: null },
    ])
  }

  function updateItem(id: string, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  async function submit() {
    if (!activeBranch) return
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one item.')
      return
    }
    if (items.some((it) => !it.label.trim())) {
      setError('Every item needs a label.')
      return
    }
    const actorName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : 'unknown')

    setBusy(true)
    setError(null)
    try {
      const batch = writeBatch(db)
      if (existing) {
        batch.update(doc(checklistTemplatesCol, existing.id), { active: false })
      }
      const newRef = doc(checklistTemplatesCol)
      batch.set(newRef, {
        branchId: activeBranch.branchId,
        name: name.trim(),
        category,
        version: (existing?.version ?? 0) + 1,
        active: true,
        items,
        createdBy: actorName,
        createdAt: serverTimestamp(),
      })
      await batch.commit()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this template.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog dialog--wide">
        <h3>{existing ? `Edit ${existing.name}` : 'New checklist template'}</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as ChecklistCategory)} disabled={!!existing}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <p className="dialog__hint">Items</p>
        {items.map((item) => (
          <div key={item.id} className="template-item-row">
            <input
              value={item.label}
              onChange={(e) => updateItem(item.id, { label: e.target.value })}
              placeholder="Item label"
            />
            <select value={item.type} onChange={(e) => updateItem(item.id, { type: e.target.value as ChecklistItemType })}>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {item.type === 'numeric' && (
              <>
                <input
                  value={item.numericMin ?? ''}
                  onChange={(e) => updateItem(item.id, { numericMin: e.target.value === '' ? null : Number(e.target.value) })}
                  placeholder="min"
                />
                <input
                  value={item.numericMax ?? ''}
                  onChange={(e) => updateItem(item.id, { numericMax: e.target.value === '' ? null : Number(e.target.value) })}
                  placeholder="max"
                />
              </>
            )}
            <button type="button" onClick={() => removeItem(item.id)}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem}>
          Add item
        </button>

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
