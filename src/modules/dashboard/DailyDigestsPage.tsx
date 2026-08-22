// docs/13-M8-DASHBOARD-DIGEST.md §2 — past dailySummaries, frozen at close.
// Never recomputed on read — this is exactly the "one document per
// business day" case the architecture note describes.
import { useEffect, useState } from 'react'
import { onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { dailySummariesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { formatCentavos } from '@/lib/format'
import type { DailySummary } from '@/lib/types'

type Row = DailySummary & { id: string }

export function DailyDigestsPage() {
  const activeBranch = useActiveBranch()
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(dailySummariesCol, where('branchId', '==', activeBranch.branchId), orderBy('businessDate', 'desc'))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  return (
    <div className="daily-digests-page">
      <h2>Digest history</h2>
      {rows.length === 0 && <p className="empty-state">No business day has been closed yet.</p>}
      {rows.map((r) => (
        <section className="card" key={r.id}>
          <h2>{r.businessDate}</h2>
          <p>
            Temperature: {r.temperature.readingsTaken}/{r.temperature.readingsDue} readings, {r.temperature.missed} missed,{' '}
            {r.temperature.excursionsOpen} excursion(s) still open.
          </p>
          <p>
            Quarantine: {r.quarantine.lotsOpen} lot(s) open, {formatCentavos(r.quarantine.estValueCentavos)} at risk.
          </p>
          <p>Maintenance: {r.maintenance.ticketsOpen} ticket(s) open.</p>
          <p>
            Exceptions: {r.exceptions.openTotal} open ({r.exceptions.overdue} overdue), {r.exceptions.opened} opened,{' '}
            {r.exceptions.closed} closed.
          </p>
          <p>
            Staffing: {r.staffing.shiftsShort}/{r.staffing.shiftsPlanned} shift(s) short.
          </p>
          <p>
            Cash: {r.cash.sessionsOpenAtClose} session(s) still open, {formatCentavos(r.cash.totalVarianceCentavos)} net variance,{' '}
            {r.cash.unresolvedInvestigations} unresolved investigation(s).
          </p>
          <p>
            Certifications: {r.certifications.expiringCount === null ? 'expiry warning window not set' : `${r.certifications.expiringCount} expiring soon`}.
          </p>
        </section>
      ))}
    </div>
  )
}
