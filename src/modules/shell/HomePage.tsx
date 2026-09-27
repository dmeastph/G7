// The real landing screen — branch/shift context plus the same live status
// tiles DashboardPage (M8) already computes via useDashboardData(), reused
// rather than duplicated so the two views can never drift apart. This
// replaces what was here before: an M0 plumbing-check scaffold ("Parameters
// seed check" / a "Send test write" button) that was never meant to ship
// as the first thing a real user sees.
import { Link } from 'react-router-dom'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { useCurrentBusinessDayId, useCurrentShift, setShiftOverride } from '@/lib/businessDay'
import { useDashboardData } from '@/modules/dashboard/actions'
import { ShiftOverridePicker } from './ShiftOverridePicker'

export function HomePage() {
  const auth = useAuth()
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const shift = useCurrentShift()
  const data = useDashboardData()

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  return (
    <div className="home-page">
      <section className="card">
        <h2>Branch</h2>
        <p>{activeBranch ? `${activeBranch.branch.name} (${activeBranch.branchId})` : 'Resolving…'}</p>
        <p>Business day: {businessDayId ?? 'resolving…'}</p>
        <p>
          Current shift:{' '}
          {shift ? `${shift.templateName} (${shift.status})` : 'no shift covers this moment'}
        </p>
        {isManager && <ShiftOverridePicker />}
        {isManager && shift && (
          <button type="button" onClick={() => setShiftOverride(null)}>
            Clear override
          </button>
        )}
      </section>

      <section className="card status-summary">
        <div className={`status-summary__tile ${data.openExceptionsBySeverity.critical + data.openExceptionsBySeverity.high > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">
            {data.openExceptionsBySeverity.critical + data.openExceptionsBySeverity.high}
          </span>
          <span>high/critical exceptions</span>
        </div>
        <div className={`status-summary__tile ${data.missedChecksToday > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.missedChecksToday}</span>
          <span>checklists missed today</span>
        </div>
        <div className={`status-summary__tile ${data.excursionsOpen.length > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.excursionsOpen.length}</span>
          <span>units out of range</span>
        </div>
        <div className={`status-summary__tile ${data.cashPendingAttention > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__count">{data.cashPendingAttention}</span>
          <span>cash counts need attention</span>
        </div>
      </section>

      {data.lowStockItems.length > 0 && (
        <section className="card">
          <h2>Low stock</h2>
          <ul>
            {data.lowStockItems.map((i) => (
              <li key={i.id}>
                {i.name} — {i.qtyOnHand} on hand, reorder point {i.reorderPoint}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p>
        <Link to="/dashboard">Full dashboard</Link>
      </p>
    </div>
  )
}
