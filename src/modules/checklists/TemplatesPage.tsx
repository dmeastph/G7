// Manager only — crew only ever see runs, never template management
// (docs/07-M2-CHECKLISTS.md §1). The rules already refuse a crew write;
// this hides the controls too, matching the pattern in
// coldchain/EquipmentListPage.tsx — a real gap caught by testing as a
// station account, not just by trusting the rules layer.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { checklistTemplatesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import type { ChecklistTemplate } from '@/lib/types'
import { TemplateFormDialog } from './TemplateFormDialog'

type Row = ChecklistTemplate & { id: string }

export function TemplatesPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [templates, setTemplates] = useState<Row[]>([])
  const [editing, setEditing] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(checklistTemplatesCol, where('branchId', '==', activeBranch.branchId), where('active', '==', true))
    return onSnapshot(q, (snap) => setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view checklist templates.</p>
      </div>
    )
  }

  return (
    <div className="templates-page">
      <div className="page-header">
        <h2>Checklist templates</h2>
        <button type="button" onClick={() => setAdding(true)}>
          New template
        </button>
      </div>

      {templates.length === 0 && <p className="empty-state">No active templates yet.</p>}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Version</th>
              <th>Items</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.category}</td>
                <td>v{t.version}</td>
                <td>{t.items.length}</td>
                <td>
                  <button type="button" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {adding && <TemplateFormDialog onClose={() => setAdding(false)} />}
      {editing && <TemplateFormDialog existing={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
