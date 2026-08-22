// Tap a unit → big numeric keypad → save, under 20 seconds
// (docs/04-M1-COLDCHAIN.md §2). Deliberately does not pre-fill the
// previous reading — see the "anti-patterns to design out" note there.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useColdChainActions } from './actions'
import type { Slot } from '@/lib/coldchain'
import type { Equipment } from '@/lib/types'

type Props = {
  equipment: Equipment & { id: string }
  slot: Slot | null
  onClose: () => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '−/+', '0', '.']

export function ReadingEntryDialog({ equipment, slot, onClose }: Props) {
  const navigate = useNavigate()
  const { saveReading } = useColdChainActions()
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoPreviewName, setPhotoPreviewName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outOfRangeResult, setOutOfRangeResult] = useState<{ valueC: number; excursionId: string | null } | null>(
    null,
  )

  function press(k: string) {
    if (k === '−/+') {
      setText((t) => (t.startsWith('-') ? t.slice(1) : `-${t}`))
      return
    }
    if (k === '.' && text.includes('.')) return
    setText((t) => t + k)
  }

  function backspace() {
    setText((t) => t.slice(0, -1))
  }

  async function save() {
    const valueC = Number(text)
    if (text.trim() === '' || Number.isNaN(valueC)) {
      setError('Enter a temperature.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Opening the excursion happens inside saveReading itself — automatic,
      // not gated on anything the user taps next (docs/04-M1-COLDCHAIN.md:
      // "An out-of-range reading opens an excursion automatically"). The
      // prompt below is only about telling the Shift Leader and navigating
      // to the incident that already exists.
      const result = await saveReading(equipment, valueC, slot?.label ?? null, photo)
      if (result.withinRange === false) {
        setOutOfRangeResult({ valueC, excursionId: result.excursionId })
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this reading.')
    } finally {
      setBusy(false)
    }
  }

  function goToExcursion() {
    if (outOfRangeResult?.excursionId) navigate(`/coldchain/excursions/${outOfRangeResult.excursionId}`)
  }

  if (outOfRangeResult) {
    return (
      <div className="dialog-backdrop">
        <div className="dialog dialog--alert">
          <h3>This is out of range</h3>
          <p className="dialog__warning">Tell the Shift Leader now.</p>
          <p>
            {equipment.assetId}: {outOfRangeResult.valueC}°C
          </p>
          <div className="dialog__actions">
            <button type="button" onClick={onClose}>
              Dismiss
            </button>
            <button type="button" onClick={goToExcursion}>
              Open excursion
            </button>
          </div>
        </div>
      </div>
    )
  }

  const range =
    equipment.thresholds && (equipment.thresholds.minC !== null || equipment.thresholds.maxC !== null)
      ? `${equipment.thresholds.minC ?? '–'} to ${equipment.thresholds.maxC ?? '–'}°C`
      : 'target not set'

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{equipment.assetId}</h3>
        <p className="dialog__hint">Target: {range}</p>
        {slot && <p className="dialog__hint">Slot: {slot.label}</p>}

        <div className="temp-display">{text || '—'}°C</div>
        {error && <p className="dialog__error">{error}</p>}

        <div className="pin-pad__grid temp-keypad">
          {KEYS.map((k) => (
            <button key={k} type="button" className="pin-pad__key" onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button type="button" className="pin-pad__key" onClick={backspace}>
            ⌫
          </button>
        </div>

        <label className="dialog__photo">
          Photo (optional)
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              setPhoto(file)
              setPhotoPreviewName(file?.name ?? null)
            }}
          />
          {photoPreviewName && <span>{photoPreviewName}</span>}
        </label>

        <div className="dialog__actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy || text.trim() === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
