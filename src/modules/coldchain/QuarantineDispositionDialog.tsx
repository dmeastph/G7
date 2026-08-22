// "Disposition requires stock.release_quarantine — store_manager and owner
// only. Enforced in rules, not just UI" (docs/04-M1-COLDCHAIN.md §4).
// `basis` is required — the manual wants the reasoning recorded, not just
// the decision.
import { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { quarantineLotsCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useWriteOperational } from '@/lib/write'
import type { QuarantineLot } from '@/lib/types'

type Outcome = 'released' | 'discarded' | 'returned' | 'pending_technician'

export function QuarantineDispositionDialog({
  lot,
  onClose,
}: {
  lot: QuarantineLot & { id: string }
  onClose: () => void
}) {
  const auth = useAuth()
  const { write } = useWriteOperational()
  const [outcome, setOutcome] = useState<Outcome>('released')
  const [basis, setBasis] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!basis.trim()) {
      setError('Basis is required — record the reasoning, not just the decision.')
      return
    }
    if (auth.mode !== 'managed') {
      setError('Sign in with a manager account to disposition quarantine.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // "Discarding links to a wastage record (stub in M1; M2 completes
      // it)" — docs/04-M1-COLDCHAIN.md §4. Written before the disposition
      // update so wastageRecordId is never dangling.
      let wastageRecordId: string | null = null
      if (outcome === 'discarded') {
        wastageRecordId = await write('wastageRecords', {
          source: 'quarantine',
          sourceId: lot.id,
          itemName: lot.itemName,
          qty: lot.qty,
          unit: lot.unit,
          estValueCentavos: lot.estValueCentavos,
          reason: basis.trim(),
        })
      }

      await updateDoc(doc(quarantineLotsCol, lot.id), {
        status: outcome,
        disposition: {
          outcome,
          basis: basis.trim(),
          decidedBy: auth.user.email ?? auth.user.uid,
          decidedAt: serverTimestamp(),
          evidenceRefs: [],
          wastageRecordId,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this disposition.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Disposition — {lot.itemName}</h3>
        <label>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            <option value="released">Released</option>
            <option value="discarded">Discarded</option>
            <option value="returned">Returned to supplier</option>
            <option value="pending_technician">Pending technician</option>
          </select>
        </label>
        <label>
          Basis (required)
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Reasoning for this decision" />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !basis.trim()}>
            {busy ? 'Saving…' : 'Save disposition'}
          </button>
        </div>
      </div>
    </div>
  )
}
