// Numeric PIN entry. Fast on a mid-range tablet, usable with one thumb —
// see the performance targets in docs/01-ARCHITECTURE.md.
import { useState } from 'react'

type Props = {
  onSubmit: (pin: string) => void
  onCancel?: () => void
  error?: string | null
  busy?: boolean
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

export function PinPad({ onSubmit, onCancel, error, busy }: Props) {
  const [pin, setPin] = useState('')

  function press(d: string) {
    if (busy) return
    if (d === '') return
    if (d === '⌫') {
      setPin((p) => p.slice(0, -1))
      return
    }
    if (pin.length < 6) setPin((p) => p + d)
  }

  function submit() {
    onSubmit(pin)
    // Clear immediately rather than waiting on the `error` prop: a second
    // wrong PIN in a row produces the same error string, so a prop-watching
    // effect wouldn't re-fire and the pad would stay stuck at 6 digits.
    setPin('')
  }

  return (
    <div className="pin-pad">
      <div className="pin-pad__dots" aria-live="polite">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className={`pin-pad__dot ${i < pin.length ? 'pin-pad__dot--filled' : ''}`} />
        ))}
      </div>
      {error && <p className="pin-pad__error">{error}</p>}
      <div className="pin-pad__grid">
        {DIGITS.map((d, i) => (
          <button
            key={i}
            type="button"
            className="pin-pad__key"
            disabled={d === ''}
            onClick={() => press(d)}
            aria-hidden={d === ''}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="pin-pad__actions">
        {onCancel && (
          <button type="button" className="pin-pad__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="pin-pad__enter"
          disabled={pin.length < 4 || busy}
          onClick={submit}
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </div>
    </div>
  )
}
