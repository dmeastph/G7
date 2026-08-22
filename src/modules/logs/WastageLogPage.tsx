// docs/07-M2-CHECKLISTS.md §5 — list + record entry. Quarantine
// discards write here automatically (see QuarantineDispositionDialog).
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { wastageRecordsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useWriteOperational } from '@/lib/write'
import { formatCentavos, toMillisSafe } from '@/lib/format'
import type { WastageRecord } from '@/lib/types'

type Row = WastageRecord & { id: string }

export function WastageLogPage() {
  const activeBranch = useActiveBranch()
  const { write } = useWriteOperational()
  const [rows, setRows] = useState<Row[]>([])
  const [itemName, setItemName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState('units')
  const [estValue, setEstValue] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(wastageRecordsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function submit() {
    if (!itemName.trim() || !qty.trim() || !reason.trim()) {
      setError('Item, quantity and reason are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('wastageRecords', {
        source: 'manual',
        sourceId: null,
        itemName: itemName.trim(),
        qty: Number(qty),
        unit,
        estValueCentavos: estValue.trim() === '' ? null : Math.round(Number(estValue) * 100),
        reason: reason.trim(),
      })
      setItemName('')
      setQty('')
      setEstValue('')
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this.')
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))

  return (
    <div className="wastage-page">
      <h2>Wastage log</h2>
      <section className="card">
        <label>
          Item
          <input value={itemName} onChange={(e) => setItemName(e.target.value)} />
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
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Recording…' : 'Record wastage'}
        </button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {sorted.length === 0 && <p className="empty-state">Nothing recorded yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Value</th>
              <th>Reason</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>{r.itemName}</td>
                <td>
                  {r.qty} {r.unit}
                </td>
                <td>{r.estValueCentavos !== null ? formatCentavos(r.estValueCentavos) : '—'}</td>
                <td>{r.reason}</td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
