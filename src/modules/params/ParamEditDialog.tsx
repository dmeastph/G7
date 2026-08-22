// Editing a requiresProfessionalSignoff parameter must name the professional
// who signs it off before it changes (docs/03-M0-FOUNDATION.md §6).
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useActiveBranch } from '@/lib/branch'
import { useOnlineStatus } from '@/lib/offline'
import { setParameter, ParamEditError, type CachedParam } from '@/lib/params'

export function ParamEditDialog({ param, onClose }: { param: CachedParam; onClose: () => void }) {
  const auth = useAuth()
  const { actor } = usePinSession()
  const activeBranch = useActiveBranch()
  const online = useOnlineStatus()
  const [value, setValue] = useState(param.value !== null ? String(param.value) : '')
  const [reason, setReason] = useState('')
  const [signoffName, setSignoffName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const actorId = actor?.userId ?? (auth.mode === 'managed' ? auth.user.uid : null)
  const actorName = actor?.displayName ?? (auth.mode === 'managed' ? auth.user.email ?? auth.user.uid : null)

  async function submit() {
    if (!actorId || !actorName || !activeBranch) return
    setBusy(true)
    setError(null)
    try {
      const isNumeric =
        param.dataType === 'number' || param.dataType === 'currency' || param.dataType === 'temperature_c' || param.dataType === 'duration_minutes'

      // An empty field must stay null ("not set"), never silently become 0 —
      // a fabricated number in a food-safety value is worse than a visible
      // gap (docs/03-M0-FOUNDATION.md §6).
      if (isNumeric && value.trim() === '') {
        throw new ParamEditError('Leave this unset on purpose by clicking Cancel — an empty field cannot be saved as zero.')
      }
      if (isNumeric && Number.isNaN(Number(value))) {
        throw new ParamEditError('Enter a valid number.')
      }

      const newValue = param.dataType === 'boolean' ? value === 'true' : isNumeric ? Number(value) : value

      if (param.requiresProfessionalSignoff && !signoffName.trim()) {
        throw new ParamEditError('Name the professional signing off this value.')
      }

      await setParameter({
        key: param.key,
        scope: param.scope,
        scopeId: param.scopeId,
        newValue,
        reason: param.requiresProfessionalSignoff ? `${reason} — signed off by ${signoffName}` : reason,
        actorId,
        actorName,
        branchId: activeBranch.branchId,
        confirmedSignoff: param.requiresProfessionalSignoff ? Boolean(signoffName.trim()) : undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof ParamEditError ? err.message : 'Could not save this change.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{param.key}</h3>
        {param.requiresProfessionalSignoff && (
          <p className="dialog__warning">
            This is a food-safety or legal value. It requires professional sign-off before it can change.
          </p>
        )}
        {!online && (
          <p className="dialog__warning">
            Parameter changes need a connection — this device is offline (docs/01-ARCHITECTURE.md). Try again once
            reconnected.
          </p>
        )}
        <label>
          Value {param.unit ? `(${param.unit})` : ''}
          {param.dataType === 'boolean' ? (
            <select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </label>
        {(param.minAllowed !== null || param.maxAllowed !== null) && (
          <p className="dialog__hint">
            Allowed range: {param.minAllowed ?? '–'} to {param.maxAllowed ?? '–'}
          </p>
        )}
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        {param.requiresProfessionalSignoff && (
          <label>
            Signed off by
            <input value={signoffName} onChange={(e) => setSignoffName(e.target.value)} placeholder="Professional's name" />
          </label>
        )}
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !reason.trim() || !online}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
