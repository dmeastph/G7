// docs/07-M2-CHECKLISTS.md §3 — "Resolving requires a corrective action and
// records who verified it."
import { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { exceptionsCol } from '@/lib/firebase'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import type { ExceptionRecord } from '@/lib/types'

export function ExceptionResolveDialog({
  exception,
  onClose,
}: {
  exception: ExceptionRecord & { id: string }
  onClose: () => void
}) {
  const { actor } = usePinSession()
  const auth = useAuth()
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentActorId = actor?.userId ?? (auth.mode === 'managed' ? auth.user.uid : null)
  const currentActorName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : null)

  async function submit() {
    if (!action.trim()) {
      setError('Describe the corrective action taken.')
      return
    }
    if (!currentActorId || !currentActorName) {
      setError('No actor set.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(exceptionsCol, exception.id), {
        status: 'resolved',
        correctiveAction: {
          action: action.trim(),
          byId: currentActorId,
          atTime: serverTimestamp(),
          verifiedById: currentActorId,
          verifiedAt: serverTimestamp(),
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve this exception.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{exception.title}</h3>
        <p className="dialog__hint">{exception.detail}</p>
        <label>
          Corrective action
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="What was done about it" />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !action.trim()}>
            {busy ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </div>
    </div>
  )
}
