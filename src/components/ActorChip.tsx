// Persistent actor display + switch-user, at most two taps
// (docs/03-M0-FOUNDATION.md §9 / acceptance criteria).
import { useState } from 'react'
import { usePinSession, verifyPin } from '@/lib/pin'
import { PinPad } from './PinPad'

type Mode = 'idle' | 'confirmSwitch' | 'entering'

export function ActorChip() {
  const { actor, setActor, clearActor, recordActivity } = usePinSession()
  const [mode, setMode] = useState<Mode>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function openChip() {
    // Tap 1: no actor yet -> straight to PIN entry. Actor present -> ask to
    // confirm switching, so an idle tap doesn't accidentally sign someone out.
    setError(null)
    setMode(actor ? 'confirmSwitch' : 'entering')
  }

  function confirmSwitch() {
    // Tap 2.
    clearActor()
    setMode('entering')
  }

  async function handlePin(pin: string) {
    setBusy(true)
    setError(null)
    const match = await verifyPin(pin)
    setBusy(false)
    if (!match) {
      setError('Wrong PIN')
      return
    }
    setActor(match)
    setMode('idle')
  }

  return (
    <div className="actor-chip" onClick={recordActivity}>
      <button type="button" className="actor-chip__button" onClick={openChip}>
        {actor ? (
          <>
            <span className="actor-chip__name">{actor.displayName}</span>
            <span className="actor-chip__switch">Switch user</span>
          </>
        ) : (
          <span className="actor-chip__name">Tap to sign in</span>
        )}
      </button>

      {mode === 'confirmSwitch' && (
        <div className="actor-chip__popover">
          <p>Switch from {actor?.displayName}?</p>
          <button type="button" onClick={confirmSwitch}>
            Switch user
          </button>
          <button type="button" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </div>
      )}

      {mode === 'entering' && (
        <div className="actor-chip__overlay">
          <PinPad onSubmit={handlePin} onCancel={() => setMode('idle')} error={error} busy={busy} />
        </div>
      )}
    </div>
  )
}
