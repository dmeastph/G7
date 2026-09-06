// docs/13-M8-DASHBOARD-DIGEST.md §1 — the live view, plus the manager-only
// close action.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { businessDaysCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { formatTimeManila, toDateSafe } from '@/lib/format'
import { closeBusinessDay, useDashboardData } from './actions'
import type { BusinessDay } from '@/lib/types'

export function DashboardPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const businessDayId = useCurrentBusinessDayId()
  const data = useDashboardData()

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null)
  const [now, setNow] = useState(new Date())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closedId, setClosedId] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!businessDayId) return
    return onSnapshot(query(businessDaysCol, where('__name__', '==', businessDayId)), (snap) => {
      setBusinessDay(snap.docs[0]?.data() ?? null)
    })
  }, [businessDayId])

  async function handleClose() {
    if (!activeBranch || !businessDayId) return
    setBusy(true)
    setError(null)
    try {
      const result = await closeBusinessDay(activeBranch.branchId, businessDayId)
      setClosedId(result.dailySummaryId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the business day.')
    } finally {
      setBusy(false)
    }
  }

  // Closing early would freeze a rollup for a day still in progress —
  // enabled only once closesAt has passed.
  const canClose = businessDay?.status === 'open' && businessDay.closesAt && toDateSafe(businessDay.closesAt).getTime() <= now.getTime()

  return (
    <div className="dashboard-page">
      <h2>Dashboard</h2>

      <section className="card status-summary">
        <div className={`status-summary__tile ${data.openExceptionsBySeverity.critical + data.openExceptionsBySeverity.high > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">
            {data.openExceptionsBySeverity.critical + data.openExceptionsBySeverity.high}
          </span>
          <span>high/critical exceptions</span>
        </div>
        <div className={`status-summary__tile ${data.openExceptionsBySeverity.low + data.openExceptionsBySeverity.medium > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">
            {data.openExceptionsBySeverity.low + data.openExceptionsBySeverity.medium}
          </span>
          <span>low/medium exceptions</span>
        </div>
        <div className={`status-summary__tile ${data.missedChecksToday > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.missedChecksToday}</span>
          <span>checklists missed today</span>
        </div>
        <div className={`status-summary__tile ${data.excursionsOpen.length > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.excursionsOpen.length}</span>
          <span>units out of range</span>
        </div>
        <div className="status-summary__tile">
          <span className="status-summary__count">{data.cashSessionsOpen}</span>
          <span>cash sessions open</span>
        </div>
        <div className={`status-summary__tile ${data.cashPendingAttention > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.cashPendingAttention}</span>
          <span>cash counts need attention</span>
        </div>
        <div className={`status-summary__tile ${data.shiftsShort > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.shiftsShort}</span>
          <span>of {data.shiftsPlanned} shifts short-staffed</span>
        </div>
        <div className={`status-summary__tile ${data.certExpiryWindowSet && data.certificationsExpiring > 0 ? 'status-summary__tile--warn' : ''}`}>
          <span className="status-summary__count">{data.certExpiryWindowSet ? data.certificationsExpiring : 'not set'}</span>
          <span>certifications expiring</span>
        </div>
      </section>

      {data.excursionsOpen.length > 0 && (
        <section className="card">
          <h2>Units currently out of range</h2>
          <ul>
            {data.excursionsOpen.map((e) => (
              <li key={e.id}>
                {e.assetId} — peak {e.peakC}°C
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Low stock</h2>
        {data.lowStockItems.length === 0 ? (
          <p className="empty-state">Nothing to reorder right now.</p>
        ) : (
          <ul>
            {data.lowStockItems.map((i) => (
              <li key={i.id}>
                {i.name} — {i.qtyOnHand} on hand, reorder point {i.reorderPoint}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isManager && (
        <section className="card">
          <h2>Close business day</h2>
          <p className="dialog__hint">
            {businessDay?.status === 'closed'
              ? 'Already closed.'
              : canClose
                ? 'Ready to close — computes the daily summary and queues the digest.'
                : `Not yet — closes at ${businessDay ? formatTimeManila(businessDay.closesAt) : '…'}.`}
          </p>
          {error && <p className="dialog__error">{error}</p>}
          {closedId && <p>Closed — see <Link to="/dashboard/digests">digest history</Link>.</p>}
          <button type="button" onClick={handleClose} disabled={busy || !canClose}>
            {busy ? 'Closing…' : 'Close business day'}
          </button>
        </section>
      )}

      <p>
        <Link to="/dashboard/digests">Digest history</Link>
      </p>
    </div>
  )
}
