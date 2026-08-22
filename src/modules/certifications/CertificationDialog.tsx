// A manager attests a certification — the assessor is recorded, staff
// never self-certify (docs/08-M3-TIME-ROSTER-CERTIFICATION.md §5).
import { useState } from 'react'
import { doc, Timestamp, updateDoc } from 'firebase/firestore'
import { usersCol } from '@/lib/firebase'
import { CERT_LEVELS, MODULE_F } from '@/lib/certification'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import type { User } from '@/lib/types'

const LEVEL_OPTIONS = [...CERT_LEVELS, MODULE_F]

export function CertificationDialog({ user, onClose }: { user: User & { id: string }; onClose: () => void }) {
  const auth = useAuth()
  const { actor } = usePinSession()
  const [level, setLevel] = useState<string>(LEVEL_OPTIONS[0])
  const [expires, setExpires] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const assessorName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : null)

  async function submit() {
    if (!assessorName) {
      setError('No assessor identity available.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(usersCol, user.id), {
        [`certifications.${level}`]: {
          certifiedAt: Timestamp.now(),
          expiresAt: expires.trim() === '' ? null : Timestamp.fromDate(new Date(expires)),
          assessorId: assessorName,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this certification.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Certify — {user.displayName}</h3>
        <label>
          Level
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {l === MODULE_F ? 'Module F (food)' : l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expires (optional)
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
        <p className="dialog__hint">Assessor: {assessorName}</p>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Certify'}
          </button>
        </div>
      </div>
    </div>
  )
}
