// docs/07-M2-CHECKLISTS.md §4 — one button to log, list of open ones with a
// resolve tap. A floor action, not a manager approval.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { queueEscalationsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useWriteOperational } from '@/lib/write'
import { ParamValue } from '@/components/ParamValue'
import type { QueueEscalation } from '@/lib/types'

type Row = QueueEscalation & { id: string }

export function QueueEscalationPage() {
  const activeBranch = useActiveBranch()
  const { write } = useWriteOperational()
  const [rows, setRows] = useState<Row[]>([])
  const [queueLength, setQueueLength] = useState('')
  const [action, setAction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(queueEscalationsCol, where('branchId', '==', activeBranch.branchId), where('resolvedAt', '==', null))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function log() {
    const length = Number(queueLength)
    if (queueLength.trim() === '' || Number.isNaN(length)) {
      setError('Enter the queue length.')
      return
    }
    if (!action.trim()) {
      setError('What action was taken?')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('queueEscalations', { queueLength: length, action: action.trim(), resolvedAt: null })
      setQueueLength('')
      setAction('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log this.')
    } finally {
      setBusy(false)
    }
  }

  async function resolve(id: string) {
    await updateDoc(doc(queueEscalationsCol, id), { resolvedAt: serverTimestamp() })
  }

  return (
    <div className="queue-page">
      <h2>Queue escalation</h2>
      <section className="card">
        <p className="dialog__hint">
          Second-till threshold: <ParamValue paramKey="service.queue_second_till_threshold" />
        </p>
        <label>
          Queue length
          <input value={queueLength} onChange={(e) => setQueueLength(e.target.value)} />
        </label>
        <label>
          Action taken
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Opened second till" />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={log} disabled={busy}>
          {busy ? 'Logging…' : 'Log escalation'}
        </button>
      </section>

      <section className="card">
        <h2>Open</h2>
        {rows.length === 0 && <p className="empty-state">Nothing open.</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              Queue of {r.queueLength} — {r.action}{' '}
              <button type="button" onClick={() => resolve(r.id)}>
                Resolve
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

