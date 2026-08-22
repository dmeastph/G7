// docs/12-M7-DOCUMENT-CONTROL.md §1 — active documents, one row per code.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { documentAcknowledgmentsCol, documentsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import type { DocumentRecord } from '@/lib/types'
import { DocumentUploadDialog } from './DocumentUploadDialog'

type Row = DocumentRecord & { id: string }

export function DocumentsListPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const [rows, setRows] = useState<Row[]>([])
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const who = actor
    ? { userId: actor.userId }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid }
      : null

  useEffect(() => {
    if (!activeBranch) return
    const q = query(documentsCol, where('branchId', '==', activeBranch.branchId), where('active', '==', true))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !who) {
      setAcknowledgedIds(new Set())
      return
    }
    const q = query(documentAcknowledgmentsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => {
      const ids = new Set<string>()
      snap.forEach((d) => {
        const data = d.data()
        if (data.actorId === who.userId) ids.add(data.documentId)
      })
      setAcknowledgedIds(ids)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, who?.userId])

  const sorted = [...rows].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="documents-page">
      <h2>Documents</h2>

      {isManager && (
        <section className="card">
          <button type="button" onClick={() => setUploading(true)}>
            Upload new version
          </button>
        </section>
      )}

      <section className="card">
        {sorted.length === 0 && <p className="empty-state">No active documents.</p>}
        <ul>
          {sorted.map((r) => (
            <li key={r.id}>
              <Link to={`/documents/${r.id}`}>
                {r.title} — {r.category} — v{r.version}
              </Link>
              {acknowledgedIds.has(r.id) ? ' — acknowledged' : ' — not yet acknowledged'}
            </li>
          ))}
        </ul>
      </section>

      {uploading && <DocumentUploadDialog existingDocuments={rows} onClose={() => setUploading(false)} />}
    </div>
  )
}
