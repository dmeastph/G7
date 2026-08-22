// docs/12-M7-DOCUMENT-CONTROL.md §3 — code either matches an existing
// active document (supersedes it) or is new (starts at version 1).
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useActiveBranch } from '@/lib/branch'
import { useDocumentActions } from './actions'
import type { DocumentCategory, DocumentRecord } from '@/lib/types'

const CATEGORIES: DocumentCategory[] = ['manual', 'sop', 'policy', 'form', 'other']

export function DocumentUploadDialog({
  existingDocuments,
  onClose,
}: {
  existingDocuments: (DocumentRecord & { id: string })[]
  onClose: () => void
}) {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const { uploadVersion } = useDocumentActions()

  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DocumentCategory>('sop')
  const [allBranches, setAllBranches] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const existingActive = existingDocuments.find((d) => d.code === code.trim())

  async function submit() {
    if (!activeBranch || !who) return
    if (!code.trim() || !title.trim() || !file) {
      setError('Code, title and a PDF file are required.')
      return
    }
    if (file.type !== 'application/pdf') {
      setError('Only PDF files are accepted.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await uploadVersion({
        branchId: activeBranch.branchId,
        code: code.trim(),
        title: title.trim(),
        category,
        branchApplicability: allBranches ? null : [activeBranch.branchId],
        file,
        existingActive: existingActive ?? null,
        actorId: who.userId,
        actorName: who.userName,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload this document.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Upload document version</h3>
        <label>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SOP-COLDCHAIN-01" />
        </label>
        {existingActive && (
          <p className="dialog__hint">
            Supersedes v{existingActive.version} — "{existingActive.title}"
          </p>
        )}
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="dialog__checkbox">
          <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} />
          Applies to all branches
        </label>
        <label>
          File (PDF)
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
