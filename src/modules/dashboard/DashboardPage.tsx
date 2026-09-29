// docs/13-M8-DASHBOARD-DIGEST.md §1 — the live view, plus the manager-only
// close action. This is also the app's landing route (`/`) — folded in what
// used to be a separate, smaller HomePage (branch/shift header, 4 of the 8
// tiles, a "Full dashboard" link-through) so there's one screen, not two
// that drift out of sync. `/dashboard` stays a redirect for old links.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { businessDaysCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { useCurrentBusinessDayId, useCurrentShift, setShiftOverride } from '@/lib/businessDay'
import { formatTimeManila, toDateSafe } from '@/lib/format'
import { closeBusinessDay, useDashboardData } from './actions'
import { ShiftOverridePicker } from '@/modules/shell/ShiftOverridePicker'
import type { BusinessDay } from '@/lib/types'

// Same icon language as SideRail's nav icons — a tile's chip says what kind
// of number this is before you've read the label.
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9L2.7 18a1.8 1.8 0 0 0 1.5 2.7h15.6a1.8 1.8 0 0 0 1.5-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}
function ChecklistIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 9l2 2 4-4M8 16h6" />
    </svg>
  )
}
function ThermometerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13.5V4a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z" />
    </svg>
  )
}
function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  )
}
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.2 12.2c2.2.3 3.8 2 3.8 4.3" />
    </svg>
  )
}
function BadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="5.5" />
      <path d="M9 13.5L7.5 21 12 18.5 16.5 21 15 13.5" />
    </svg>
  )
}

export function DashboardPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const businessDayId = useCurrentBusinessDayId()
  const shift = useCurrentShift()
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
          <span className="status-summary__icon-chip"><AlertIcon /></span>
          <span className="status-summary__count">
            {data.openExceptionsBySeverity.critical + data.openExceptionsBySeverity.high}
          </span>
          <span className="status-summary__label">high/critical exceptions</span>
        </div>
        <div className={`status-summary__tile ${data.openExceptionsBySeverity.low + data.openExceptionsBySeverity.medium > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__icon-chip"><AlertIcon /></span>
          <span className="status-summary__count">
            {data.openExceptionsBySeverity.low + data.openExceptionsBySeverity.medium}
          </span>
          <span className="status-summary__label">low/medium exceptions</span>
        </div>
        <div className={`status-summary__tile ${data.missedChecksToday > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__icon-chip"><ChecklistIcon /></span>
          <span className="status-summary__count">{data.missedChecksToday}</span>
          <span className="status-summary__label">checklists missed today</span>
        </div>
        <div className={`status-summary__tile ${data.excursionsOpen.length > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__icon-chip"><ThermometerIcon /></span>
          <span className="status-summary__count">{data.excursionsOpen.length}</span>
          <span className="status-summary__label">units out of range</span>
        </div>
        <div className="status-summary__tile">
          <span className="status-summary__icon-chip"><WalletIcon /></span>
          <span className="status-summary__count">{data.cashSessionsOpen}</span>
          <span className="status-summary__label">cash sessions open</span>
        </div>
        <div className={`status-summary__tile ${data.cashPendingAttention > 0 ? 'status-summary__tile--warn' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__icon-chip"><WalletIcon /></span>
          <span className="status-summary__count">{data.cashPendingAttention}</span>
          <span className="status-summary__label">cash counts need attention</span>
        </div>
        <div className={`status-summary__tile ${data.shiftsShort > 0 ? 'status-summary__tile--bad' : 'status-summary__tile--ok'}`}>
          <span className="status-summary__icon-chip"><PeopleIcon /></span>
          <span className="status-summary__count">{data.shiftsShort}</span>
          <span className="status-summary__label">of {data.shiftsPlanned} shifts short-staffed</span>
        </div>
        <div className={`status-summary__tile ${data.certExpiryWindowSet && data.certificationsExpiring > 0 ? 'status-summary__tile--warn' : ''}`}>
          <span className="status-summary__icon-chip"><BadgeIcon /></span>
          <span className="status-summary__count">{data.certExpiryWindowSet ? data.certificationsExpiring : 'not set'}</span>
          <span className="status-summary__label">certifications expiring</span>
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
