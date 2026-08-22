// Crew can create a quarantine lot; only a manager can later disposition it
// (docs/04-M1-COLDCHAIN.md §4). This dialog only covers creation.
import { useState } from 'react'
import { useWriteOperational } from '@/lib/write'
import type { Equipment } from '@/lib/types'

type Props = {
  excursionId: string
  equipment: Equipment & { id: string }
  onClose: () => void
}

export function QuarantineLotDialog({ excursionId, onClose }: Props) {
  const { write } = useWriteOperational()
  const [itemName, setItemName] = useState('')
  const [lot, setLot] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('units')
  const [estValue, setEstValue] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!itemName.trim() || !qty.trim()) {
      setError('Item and quantity are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('quarantineLots', {
        excursionId,
        itemName: itemName.trim(),
        lot: lot.trim() || null,
        qty: Number(qty),
        unit,
        estValueCentavos: estValue.trim() === '' ? null : Math.round(Number(estValue) * 100),
        location,
        status: 'quarantined',
        disposition: null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not quarantine this lot.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Quarantine a lot</h3>
        <label>
          Item
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} />
        </label>
        <label>
          Lot / batch (optional)
          <input value={lot} onChange={(e) => setLot(e.target.value)} />
        </label>
        <label>
          Quantity
          <input value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label>
          Unit
          <input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
        <label>
          Estimated value (₱, optional)
          <input value={estValue} onChange={(e) => setEstValue(e.target.value)} />
        </label>
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Quarantine'}
          </button>
        </div>
      </div>
    </div>
  )
}
