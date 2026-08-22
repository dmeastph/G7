// docs/10-M5-INCIDENTS.md §1, §3 — typed capture + the incidents list.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { incidentRecordsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { formatTimeManila, toMillisSafe } from '@/lib/format'
import { useIncidentActions } from './actions'
import type { IncidentRecord, IncidentType } from '@/lib/types'

type Row = IncidentRecord & { id: string }

const TYPE_LABEL: Record<IncidentType, string> = {
  theft: 'Theft',
  injury: 'Injury',
  altercation: 'Altercation',
  property_damage: 'Property damage',
  safety: 'Safety',
  security: 'Security',
  other: 'Other',
}

function nowForInput(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function IncidentsListPage() {
  const activeBranch = useActiveBranch()
  const { reportIncident } = useIncidentActions()
  const [rows, setRows] = useState<Row[]>([])

  const [type, setType] = useState<IncidentType>('other')
  const [severity, setSeverity] = useState<IncidentRecord['severity']>('medium')
  const [occurredAt, setOccurredAt] = useState(nowForInput())
  const [narrative, setNarrative] = useState('')
  const [immediateAction, setImmediateAction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(incidentRecordsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function submit() {
    if (!narrative.trim()) {
      setError('A narrative is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reportIncident({
        type,
        severity,
        occurredAt: new Date(occurredAt),
        narrative: narrative.trim(),
        immediateAction: immediateAction.trim(),
      })
      setNarrative('')
      setImmediateAction('')
      setOccurredAt(nowForInput())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not report this incident.')
    } finally {
      setBusy(false)
    }
  }

  const active = [...rows]
    .filter((r) => r.status !== 'closed')
    .sort((a, b) => toMillisSafe(b.occurredAt) - toMillisSafe(a.occurredAt))
  const closed = [...rows]
    .filter((r) => r.status === 'closed')
    .sort((a, b) => toMillisSafe(b.occurredAt) - toMillisSafe(a.occurredAt))

  return (
    <div className="incidents-page">
      <h2>Incidents</h2>

      <section className="card">
        <h2>Report incident</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
            {(Object.keys(TYPE_LABEL) as IncidentType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentRecord['severity'])}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>
          When it happened
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
        </label>
        <label>
          Narrative
          <input value={narrative} onChange={(e) => setNarrative(e.target.value)} />
        </label>
        <label>
          Immediate action taken
          <input value={immediateAction} onChange={(e) => setImmediateAction(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Reporting…' : 'Report incident'}
        </button>
      </section>

      <section className="card">
        <h2>Open</h2>
        {active.length === 0 && <p className="empty-state">No open incidents.</p>}
        <ul>
          {active.map((r) => (
            <li key={r.id}>
              <Link to={`/incidents/${r.id}`}>
                {TYPE_LABEL[r.type]} — {r.severity} — {formatTimeManila(r.occurredAt)} — {r.status}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {closed.length > 0 && (
        <section className="card">
          <h2>Closed</h2>
          <ul>
            {closed.map((r) => (
              <li key={r.id}>
                <Link to={`/incidents/${r.id}`}>
                  {TYPE_LABEL[r.type]} — {r.severity} — {formatTimeManila(r.occurredAt)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
