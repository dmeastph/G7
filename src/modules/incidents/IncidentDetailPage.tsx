// docs/10-M5-INCIDENTS.md §2 — CCTV preservation, escalation, closure.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot, query, where } from 'firebase/firestore'
import { cctvPreservationsCol, incidentRecordsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { formatTimeManila } from '@/lib/format'
import { useIncidentActions } from './actions'
import type { CctvPreservation, IncidentRecord } from '@/lib/types'

function nowForInput(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { preserveClip, escalate, closeIncident } = useIncidentActions()

  const currentActorName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : '')

  const [incident, setIncident] = useState<(IncidentRecord & { id: string }) | null>(null)
  const [clips, setClips] = useState<(CctvPreservation & { id: string })[]>([])

  const [cameras, setCameras] = useState('')
  const [rangeStart, setRangeStart] = useState(nowForInput())
  const [rangeEnd, setRangeEnd] = useState(nowForInput())
  const [clipRef, setClipRef] = useState('')
  const [retainUntil, setRetainUntil] = useState('')
  const [rootCause, setRootCause] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(incidentRecordsCol, id), (snap) => {
      const data = snap.data()
      setIncident(data ? { id, ...data } : null)
    })
  }, [id])

  useEffect(() => {
    if (!id || !activeBranch) return
    const q = query(cctvPreservationsCol, where('branchId', '==', activeBranch.branchId), where('incidentId', '==', id))
    return onSnapshot(q, (snap) => setClips(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [id, activeBranch])

  async function handlePreserveClip() {
    if (!id || !clipRef.trim() || !retainUntil) {
      setError('Clip reference and retain-until date are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await preserveClip(id, {
        cameras: cameras.split(',').map((c) => c.trim()).filter(Boolean),
        rangeStart: new Date(rangeStart),
        rangeEnd: new Date(rangeEnd),
        clipRef: clipRef.trim(),
        retainUntil: new Date(retainUntil),
      })
      setCameras('')
      setClipRef('')
      setRetainUntil('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this preservation.')
    } finally {
      setBusy(false)
    }
  }

  async function handleEscalate() {
    if (!incident) return
    setBusy(true)
    try {
      await escalate(incident)
    } finally {
      setBusy(false)
    }
  }

  async function handleClose() {
    if (!id || !rootCause.trim()) return
    setBusy(true)
    try {
      await closeIncident(id, rootCause.trim(), currentActorName)
    } finally {
      setBusy(false)
    }
  }

  if (!incident || !id) return <p>Loading…</p>

  return (
    <div className="incident-page">
      <h2>
        {incident.type} — {incident.severity} — {incident.status}
      </h2>
      <p>Occurred {formatTimeManila(incident.occurredAt)}</p>
      <p>{incident.narrative}</p>
      {incident.immediateAction && <p>Immediate action: {incident.immediateAction}</p>}

      <section className="card">
        <h2>CCTV preservation</h2>
        {clips.length === 0 && <p className="empty-state">No clips preserved for this incident.</p>}
        <ul>
          {clips.map((c) => (
            <li key={c.id}>
              {c.cameras.join(', ') || 'unlabeled camera'} — {formatTimeManila(c.rangeStart)} to{' '}
              {formatTimeManila(c.rangeEnd)} — {c.clipRef} — retain until {c.retainUntil.toDate().toLocaleDateString()}
            </li>
          ))}
        </ul>

        <label>
          Cameras (comma-separated)
          <input value={cameras} onChange={(e) => setCameras(e.target.value)} />
        </label>
        <label>
          Range start
          <input type="datetime-local" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
        </label>
        <label>
          Range end
          <input type="datetime-local" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
        </label>
        <label>
          Clip reference (where the export lives)
          <input value={clipRef} onChange={(e) => setClipRef(e.target.value)} />
        </label>
        <label>
          Retain until
          <input type="date" value={retainUntil} onChange={(e) => setRetainUntil(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={handlePreserveClip} disabled={busy}>
          Preserve clip
        </button>
      </section>

      {incident.status !== 'closed' && (
        <section className="card">
          <h2>Escalate</h2>
          {incident.status === 'escalated' ? (
            <p>Already escalated.</p>
          ) : (
            <button type="button" onClick={handleEscalate} disabled={busy}>
              Escalate
            </button>
          )}
        </section>
      )}

      {incident.status !== 'closed' && (
        <section className="card">
          <h2>Close</h2>
          <label>
            Root cause
            <input value={rootCause} onChange={(e) => setRootCause(e.target.value)} required />
          </label>
          <button type="button" onClick={handleClose} disabled={busy || !rootCause.trim()}>
            Close incident
          </button>
        </section>
      )}

      {incident.status === 'closed' && (
        <section className="card">
          <h2>Closed</h2>
          <p>Root cause: {incident.rootCause}</p>
          <p>Closed by {incident.closedBy}</p>
        </section>
      )}
    </div>
  )
}
