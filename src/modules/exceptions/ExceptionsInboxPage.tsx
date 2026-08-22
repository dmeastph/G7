// docs/07-M2-CHECKLISTS.md §3 — "The inbox lists open/in-progress/escalated
// exceptions from every source, including M1's."
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { exceptionsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { reconcileCarriedForwardExceptions } from './reconcile'
import { ExceptionResolveDialog } from './ExceptionResolveDialog'
import type { ExceptionRecord } from '@/lib/types'

type Row = ExceptionRecord & { id: string }

const SEVERITY_ORDER: Record<Row['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 }

export function ExceptionsInboxPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const [exceptions, setExceptions] = useState<Row[]>([])
  const [resolving, setResolving] = useState<Row | null>(null)
  const [severityFilter, setSeverityFilter] = useState<'all' | Row['severity']>('all')

  useEffect(() => {
    if (!activeBranch) return
    const q = query(
      exceptionsCol,
      where('branchId', '==', activeBranch.branchId),
      where('status', 'in', ['open', 'in_progress', 'escalated']),
    )
    return onSnapshot(q, (snap) => setExceptions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    reconcileCarriedForwardExceptions(activeBranch.branchId, businessDayId)
  }, [activeBranch, businessDayId])

  const filtered = exceptions
    .filter((e) => severityFilter === 'all' || e.severity === severityFilter)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return (
    <div className="exceptions-page">
      <div className="page-header">
        <h2>Exceptions</h2>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {filtered.length === 0 && <p className="empty-state">Nothing open.</p>}

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Title</th>
              <th>Source</th>
              <th>Status</th>
              <th>Carried forward</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className={e.severity === 'critical' ? 'status-page__out-of-range' : ''}>
                <td>{e.severity}</td>
                <td>{e.title}</td>
                <td>{e.source}</td>
                <td>{e.status}</td>
                <td>{e.carriedForwardCount}</td>
                <td>
                  <button type="button" onClick={() => setResolving(e)}>
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {resolving && <ExceptionResolveDialog exception={resolving} onClose={() => setResolving(null)} />}
    </div>
  )
}
