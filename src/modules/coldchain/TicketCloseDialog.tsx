// "A ticket cannot close without verifiedWorkingBy" — enforced here and in
// firestore.rules (docs/04-M1-COLDCHAIN.md §5).
import { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { maintenanceTicketsCol } from '@/lib/firebase'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import type { MaintenanceTicket } from '@/lib/types'

export function TicketCloseDialog({
  ticket,
  onClose,
}: {
  ticket: MaintenanceTicket & { id: string }
  onClose: () => void
}) {
  const { actor } = usePinSession()
  const auth = useAuth()
  const [diagnosis, setDiagnosis] = useState(ticket.diagnosis)
  const [workDone, setWorkDone] = useState(ticket.workDone)
  const [verifiedWorkingBy, setVerifiedWorkingBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentActorName = actor?.displayName ?? (auth.mode === 'managed' ? auth.user.email ?? auth.user.uid : '')

  async function submit() {
    if (!verifiedWorkingBy.trim()) {
      setError('Verified by is required — a ticket closed on a technician’s word alone is how the fault returns.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateDoc(doc(maintenanceTicketsCol, ticket.id), {
        diagnosis,
        workDone,
        verifiedWorkingBy: verifiedWorkingBy.trim(),
        status: 'closed',
        closedAt: serverTimestamp(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close this ticket.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Close ticket — {ticket.assetId}</h3>
        <label>
          Diagnosis
          <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
        </label>
        <label>
          Work done
          <input value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
        </label>
        <label>
          Verified working by
          <input
            value={verifiedWorkingBy}
            onChange={(e) => setVerifiedWorkingBy(e.target.value)}
            placeholder={currentActorName}
          />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !verifiedWorkingBy.trim()}>
            {busy ? 'Closing…' : 'Close ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}
