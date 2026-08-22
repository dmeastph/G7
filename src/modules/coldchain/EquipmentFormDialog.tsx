// Manager can add and edit; crew read-only (docs/04-M1-COLDCHAIN.md §1).
// Thresholds may be left blank on purpose — never invent one.
import { useState } from 'react'
import { useActiveBranch } from '@/lib/branch'
import { createEquipment, updateEquipment } from '@/lib/equipment'
import type { Equipment, EquipmentType } from '@/lib/types'

const EQUIPMENT_TYPES: EquipmentType[] = [
  'chiller',
  'freezer',
  'chest_freezer',
  'undercounter',
  'cooker',
  'microwave',
  'rice_cooker',
  'hot_hold',
  'fryer',
  'aircon',
  'other',
]

type Props = {
  existing?: (Equipment & { id: string }) | null
  onClose: () => void
}

export function EquipmentFormDialog({ existing, onClose }: Props) {
  const activeBranch = useActiveBranch()
  const [assetId, setAssetId] = useState(existing?.assetId ?? '')
  const [type, setType] = useState<EquipmentType>(existing?.type ?? 'chiller')
  const [make, setMake] = useState(existing?.make ?? '')
  const [model, setModel] = useState(existing?.model ?? '')
  const [serial, setSerial] = useState(existing?.serial ?? '')
  const [supplier, setSupplier] = useState(existing?.supplier ?? '')
  const [zone, setZone] = useState(existing?.zone ?? '')
  const [requiresTemperatureLog, setRequiresTemperatureLog] = useState(existing?.requiresTemperatureLog ?? true)
  const [minC, setMinC] = useState(existing?.thresholds?.minC?.toString() ?? '')
  const [maxC, setMaxC] = useState(existing?.thresholds?.maxC?.toString() ?? '')
  const [maxExcursionMinutes, setMaxExcursionMinutes] = useState(
    existing?.thresholds?.maxExcursionMinutes?.toString() ?? '',
  )
  const [thresholdSource, setThresholdSource] = useState(existing?.thresholdSource ?? 'unset')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!activeBranch) return
    if (!assetId.trim()) {
      setError('Asset ID is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Blank means unset — never coerce to 0 (docs/04-M1-COLDCHAIN.md §1:
      // "never invent one"), same reasoning as the parameter editor.
      const thresholds =
        minC.trim() === '' && maxC.trim() === '' && maxExcursionMinutes.trim() === ''
          ? null
          : {
              minC: minC.trim() === '' ? null : Number(minC),
              maxC: maxC.trim() === '' ? null : Number(maxC),
              maxExcursionMinutes: maxExcursionMinutes.trim() === '' ? null : Number(maxExcursionMinutes),
            }

      const data: Equipment = {
        branchId: activeBranch.branchId,
        assetId: assetId.trim(),
        type,
        make,
        model,
        serial,
        supplier,
        purchaseDate: existing?.purchaseDate ?? null,
        warrantyExpiry: existing?.warrantyExpiry ?? null,
        zone,
        status: existing?.status ?? 'active',
        requiresTemperatureLog,
        thresholds,
        thresholdSource: thresholds ? thresholdSource || 'unset' : 'unset',
        notes,
      }

      if (existing) {
        await updateEquipment(existing.id, data)
      } else {
        await createEquipment(data)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this unit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{existing ? `Edit ${existing.assetId}` : 'Add equipment'}</h3>
        <label>
          Asset ID
          <input value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder="CH-01" />
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as EquipmentType)}>
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zone
          <input value={zone} onChange={(e) => setZone(e.target.value)} />
        </label>
        <label>
          Make
          <input value={make} onChange={(e) => setMake(e.target.value)} />
        </label>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          Serial
          <input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
        <label>
          Supplier
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <label className="dialog__checkbox">
          <input
            type="checkbox"
            checked={requiresTemperatureLog}
            onChange={(e) => setRequiresTemperatureLog(e.target.checked)}
          />
          Requires temperature log
        </label>

        <p className="dialog__hint">Thresholds — leave blank if not yet known. A blank threshold never blocks a reading.</p>
        <label>
          Min °C
          <input value={minC} onChange={(e) => setMinC(e.target.value)} placeholder="not set" />
        </label>
        <label>
          Max °C
          <input value={maxC} onChange={(e) => setMaxC(e.target.value)} placeholder="not set" />
        </label>
        <label>
          Max excursion minutes
          <input
            value={maxExcursionMinutes}
            onChange={(e) => setMaxExcursionMinutes(e.target.value)}
            placeholder="not set"
          />
        </label>
        <label>
          Threshold source
          <input
            value={thresholdSource}
            onChange={(e) => setThresholdSource(e.target.value)}
            placeholder="Manual Appendix G / manufacturer"
          />
        </label>
        <label>
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

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
