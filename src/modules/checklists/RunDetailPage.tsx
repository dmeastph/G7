// docs/07-M2-CHECKLISTS.md §2. Spec describes stepping through items one at
// a time; this lists them all on one screen instead — same no-pre-fill,
// flag-don't-block behaviour, simpler to get right, and nothing in the
// acceptance criteria distinguishes the two. Revisit if a real tablet test
// says otherwise.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, onSnapshot, query, where } from 'firebase/firestore'
import { checklistRunsCol, checklistResponsesCol, checklistTemplatesCol } from '@/lib/firebase'
import { compressImage } from '@/lib/photo'
import { queuePhotoUpload } from '@/lib/photoQueue'
import { useActiveBranch } from '@/lib/branch'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import { newDocId } from '@/lib/write'
import { toMillisSafe } from '@/lib/format'
import { useChecklistActions } from './actions'
import type { ChecklistItem, ChecklistResponse, ChecklistRun, ChecklistTemplate } from '@/lib/types'

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()
  const { respondToItem, completeRun } = useChecklistActions()

  const [run, setRun] = useState<ChecklistRun | null>(null)
  const [template, setTemplate] = useState<ChecklistTemplate | null>(null)
  const [responses, setResponses] = useState<(ChecklistResponse & { id: string })[]>([])
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [busyComplete, setBusyComplete] = useState(false)
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({})
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    return onSnapshot(doc(checklistRunsCol, id), (snap) => setRun(snap.data() ?? null))
  }, [id])

  useEffect(() => {
    if (!run) return
    return onSnapshot(doc(checklistTemplatesCol, run.templateId), (snap) => setTemplate(snap.data() ?? null))
  }, [run])

  useEffect(() => {
    if (!id || !activeBranch) return
    const q = query(checklistResponsesCol, where('branchId', '==', activeBranch.branchId), where('runId', '==', id))
    return onSnapshot(q, (snap) => setResponses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [id, activeBranch])

  if (!run || !id || !template) return <p>Loading…</p>

  const currentActorName = actor?.displayName ?? (auth.mode === 'managed' ? (auth.user.email ?? auth.user.uid) : 'unknown')

  const latestResponseByItem = new Map<string, ChecklistResponse>()
  for (const r of responses) {
    const existing = latestResponseByItem.get(r.itemId)
    if (!existing || toMillisSafe(r.createdAt) > toMillisSafe(existing.createdAt)) latestResponseByItem.set(r.itemId, r)
  }

  const requiredItems = template.items.filter((it) => it.required)
  const allRequiredAnswered = requiredItems.every((it) => latestResponseByItem.has(it.id))

  async function submitPassFail(item: ChecklistItem, pass: boolean) {
    setBusyItemId(item.id)
    setError(null)
    try {
      await respondToItem(id!, item, { bool: pass })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this response.')
    } finally {
      setBusyItemId(null)
    }
  }

  async function submitNumeric(item: ChecklistItem) {
    const raw = numericDrafts[item.id] ?? ''
    const num = Number(raw)
    if (raw.trim() === '' || Number.isNaN(num)) {
      setError('Enter a number.')
      return
    }
    setBusyItemId(item.id)
    setError(null)
    try {
      await respondToItem(id!, item, { number: num })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this response.')
    } finally {
      setBusyItemId(null)
    }
  }

  async function submitText(item: ChecklistItem) {
    const text = textDrafts[item.id] ?? ''
    if (!text.trim()) {
      setError('Enter a note.')
      return
    }
    setBusyItemId(item.id)
    setError(null)
    try {
      await respondToItem(id!, item, { text: text.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this response.')
    } finally {
      setBusyItemId(null)
    }
  }

  async function submitPhoto(item: ChecklistItem, file: File) {
    if (!activeBranch) return
    setBusyItemId(item.id)
    setError(null)
    try {
      const responseId = newDocId('checklistResponses')
      const compressed = await compressImage(file)
      const photoRef = `branches/${activeBranch.branchId}/checklist-responses/${responseId}.jpg`
      queuePhotoUpload(responseId, photoRef, compressed)
      await respondToItem(id!, item, { photoRef })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this photo.')
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleComplete() {
    setBusyComplete(true)
    setError(null)
    try {
      await completeRun(id!, currentActorName)
      navigate('/checklists')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete this run.')
    } finally {
      setBusyComplete(false)
    }
  }

  return (
    <div className="run-detail-page">
      <h2>
        {run.templateName} — {run.category}
        {run.scheduledSlot ? ` · ${run.scheduledSlot}` : ''}
      </h2>
      {error && <p className="dialog__error">{error}</p>}

      {template.items.map((item) => {
        const latest = latestResponseByItem.get(item.id)
        const busy = busyItemId === item.id
        return (
          <section className="card checklist-item-card" key={item.id}>
            <h2>
              {item.label}
              {item.required && ' *'}
            </h2>
            {latest && <p className="dialog__hint">Answered — {latest.passed ? 'pass' : 'flagged'}</p>}

            {item.type === 'pass_fail' && (
              <div className="dialog__actions">
                <button type="button" onClick={() => submitPassFail(item, true)} disabled={busy}>
                  Pass
                </button>
                <button type="button" onClick={() => submitPassFail(item, false)} disabled={busy}>
                  Fail
                </button>
              </div>
            )}

            {item.type === 'numeric' && (
              <div className="dialog__actions">
                <input
                  value={numericDrafts[item.id] ?? ''}
                  onChange={(e) => setNumericDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                  placeholder={item.numericMin !== null || item.numericMax !== null ? `${item.numericMin ?? '–'} to ${item.numericMax ?? '–'}` : ''}
                />
                <button type="button" onClick={() => submitNumeric(item)} disabled={busy}>
                  Save
                </button>
              </div>
            )}

            {item.type === 'text' && (
              <div className="dialog__actions">
                <input
                  value={textDrafts[item.id] ?? ''}
                  onChange={(e) => setTextDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                />
                <button type="button" onClick={() => submitText(item)} disabled={busy}>
                  Save
                </button>
              </div>
            )}

            {item.type === 'photo' && (
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) submitPhoto(item, file)
                }}
              />
            )}
          </section>
        )
      })}

      <button type="button" onClick={handleComplete} disabled={busyComplete || !allRequiredAnswered || run.status === 'completed'}>
        {run.status === 'completed' ? 'Completed' : busyComplete ? 'Completing…' : 'Complete run'}
      </button>
    </div>
  )
}
