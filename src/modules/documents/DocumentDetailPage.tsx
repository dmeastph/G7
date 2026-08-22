// docs/12-M7-DOCUMENT-CONTROL.md §2 — view (opens the Storage URL directly,
// never rendered in-app), acknowledge, version history.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { documentAcknowledgmentsCol, documentsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { formatTimeManila } from '@/lib/format'
import { useDocumentActions } from './actions'
import type { DocumentAcknowledgment, DocumentRecord } from '@/lib/types'

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const { acknowledge, getViewUrl } = useDocumentActions()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [record, setRecord] = useState<(DocumentRecord & { id: string }) | null>(null)
  const [acks, setAcks] = useState<(DocumentAcknowledgment & { id: string })[]>([])
  const [versions, setVersions] = useState<(DocumentRecord & { id: string })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(documentsCol, id), (snap) => {
      const data = snap.data()
      setRecord(data ? { id, ...data } : null)
    })
  }, [id])

  useEffect(() => {
    if (!id || !activeBranch) return
    const q = query(documentAcknowledgmentsCol, where('branchId', '==', activeBranch.branchId), where('documentId', '==', id))
    return onSnapshot(q, (snap) => setAcks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [id, activeBranch])

  useEffect(() => {
    if (!record || !activeBranch) return
    const q = query(
      documentsCol,
      where('branchId', '==', activeBranch.branchId),
      where('code', '==', record.code),
      orderBy('version', 'desc'),
    )
    return onSnapshot(q, (snap) => setVersions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.code, activeBranch])

  async function handleView() {
    if (!record) return
    setError(null)
    try {
      const url = await getViewUrl(record.fileRef)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this document.')
    }
  }

  async function handleAcknowledge() {
    if (!record) return
    setBusy(true)
    setError(null)
    try {
      await acknowledge(record.id, record.code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record acknowledgment.')
    } finally {
      setBusy(false)
    }
  }

  if (!record || !id) return <p>Loading…</p>

  const myAck = who ? acks.find((a) => a.actorId === who.userId) : null

  return (
    <div className="document-page">
      <h2>
        {record.title} — v{record.version}
      </h2>
      <p>
        {record.category} — {record.branchApplicability === null ? 'all branches' : record.branchApplicability.join(', ')}
      </p>

      <section className="card">
        <button type="button" onClick={handleView}>
          View document
        </button>
        {error && <p className="dialog__error">{error}</p>}
      </section>

      <section className="card">
        <h2>Acknowledge</h2>
        {myAck ? (
          <p>Acknowledged by you at {formatTimeManila(myAck.createdAt)}.</p>
        ) : (
          <button type="button" onClick={handleAcknowledge} disabled={busy}>
            {busy ? 'Recording…' : 'I have read this'}
          </button>
        )}
      </section>

      {versions.length > 1 && (
        <section className="card">
          <h2>Version history</h2>
          <ul>
            {versions.map((v) => (
              <li key={v.id}>
                v{v.version} — {v.active ? 'active' : 'superseded'}
                {v.id !== record.id && <> — <Link to={`/documents/${v.id}`}>open</Link></>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
