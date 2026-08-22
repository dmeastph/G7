// Raise from a unit or from an excursion — docs/04-M1-COLDCHAIN.md §5.
// Shows warrantyExpiry from the equipment record: "it is the moment
// someone needs to know."
import { useState } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { excursionsCol } from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import type { Equipment } from '@/lib/types'

type Props = {
  equipment: Equipment & { id: string }
  excursionId?: string
  onClose: () => void
}

export function TicketFormDialog({ equipment, excursionId, onClose }: Props) {
  const { write } = useWriteOperational()
  const [symptom, setSymptom] = useState('')
  const [tradeImpact, setTradeImpact] = useState<'none' | 'reduced' | 'stopped'>('none')
  const [stockAtRisk, setStockAtRisk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const warrantyText = equipment.warrantyExpiry
    ? `Warranty expires ${equipment.warrantyExpiry.toDate().toLocaleDateString('en-PH')}`
    : 'No warranty expiry on file'

  async function submit() {
    if (!symptom.trim()) {
      setError('Describe the symptom.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ticketId = await write('maintenanceTickets', {
        equipmentId: equipment.id,
        assetId: equipment.assetId,
        symptom: symptom.trim(),
        tradeImpact,
        stockAtRisk,
        reportedAt: serverTimestamp(),
        technician: null,
        calledAt: null,
        attendedAt: null,
        diagnosis: '',
        workDone: '',
        partsReplaced: '',
        underWarranty: null,
        costCentavos: null,
        invoiceRef: '',
        downtimeMinutes: null,
        preventiveAdvice: '',
        status: 'open',
        verifiedWorkingBy: null,
        closedAt: null,
      })
      if (excursionId) {
        await updateDoc(doc(excursionsCol, excursionId), { ticketId })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise this ticket.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Raise a ticket — {equipment.assetId}</h3>
        <p className="dialog__hint">{warrantyText}</p>
        <label>
          Symptom
          <input value={symptom} onChange={(e) => setSymptom(e.target.value)} placeholder="Plain words" />
        </label>
        <label>
          Trade impact
          <select value={tradeImpact} onChange={(e) => setTradeImpact(e.target.value as typeof tradeImpact)}>
            <option value="none">None</option>
            <option value="reduced">Reduced</option>
            <option value="stopped">Stopped</option>
          </select>
        </label>
        <label className="dialog__checkbox">
          <input type="checkbox" checked={stockAtRisk} onChange={(e) => setStockAtRisk(e.target.checked)} />
          Stock at risk
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Raising…' : 'Raise ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}
