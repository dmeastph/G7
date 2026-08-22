import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAuth, type AuthState } from '@/lib/auth'
import { useActiveBranch } from '@/lib/branch'
import { useOnlineStatus } from '@/lib/offline'
import { refreshPinCache, shouldRefreshPinCache } from '@/lib/pin'
import { retryQueuedPhotoUploads } from '@/lib/photoQueue'
import { SignInForm } from '@/components/SignInForm'
import { OfflineBanner } from '@/components/OfflineBanner'
import { ActorChip } from '@/components/ActorChip'
import { BottomNav } from '@/components/BottomNav'
import { SideRail } from '@/components/SideRail'
// HomePage loads eagerly — it's the first thing rendered on every cold
// start, so lazy-loading it would only add a flicker on the most common
// path. Every other route is code-split: the tablet never needs the cash,
// document-upload or roster-builder code just to show the home screen
// (docs/01-ARCHITECTURE.md performance targets — see also the bundle-size
// note this split was written to address).
import { HomePage } from '@/modules/shell/HomePage'

const MorePage = lazy(() => import('@/modules/shell/MorePage').then((m) => ({ default: m.MorePage })))
const ParamsAdminPage = lazy(() => import('@/modules/params/ParamsAdminPage').then((m) => ({ default: m.ParamsAdminPage })))
const ColdChainStatusPage = lazy(() => import('@/modules/coldchain/ColdChainStatusPage').then((m) => ({ default: m.ColdChainStatusPage })))
const EquipmentListPage = lazy(() => import('@/modules/coldchain/EquipmentListPage').then((m) => ({ default: m.EquipmentListPage })))
const TakeReadingsPage = lazy(() => import('@/modules/coldchain/TakeReadingsPage').then((m) => ({ default: m.TakeReadingsPage })))
const ExcursionDetailPage = lazy(() => import('@/modules/coldchain/ExcursionDetailPage').then((m) => ({ default: m.ExcursionDetailPage })))
const QuarantinePage = lazy(() => import('@/modules/coldchain/QuarantinePage').then((m) => ({ default: m.QuarantinePage })))
const TicketsPage = lazy(() => import('@/modules/coldchain/TicketsPage').then((m) => ({ default: m.TicketsPage })))
const TemplatesPage = lazy(() => import('@/modules/checklists/TemplatesPage').then((m) => ({ default: m.TemplatesPage })))
const RunChecklistsPage = lazy(() => import('@/modules/checklists/RunChecklistsPage').then((m) => ({ default: m.RunChecklistsPage })))
const RunDetailPage = lazy(() => import('@/modules/checklists/RunDetailPage').then((m) => ({ default: m.RunDetailPage })))
const ExceptionsInboxPage = lazy(() => import('@/modules/exceptions/ExceptionsInboxPage').then((m) => ({ default: m.ExceptionsInboxPage })))
const QueueEscalationPage = lazy(() => import('@/modules/logs/QueueEscalationPage').then((m) => ({ default: m.QueueEscalationPage })))
const WastageLogPage = lazy(() => import('@/modules/logs/WastageLogPage').then((m) => ({ default: m.WastageLogPage })))
const ReceivingLogPage = lazy(() => import('@/modules/logs/ReceivingLogPage').then((m) => ({ default: m.ReceivingLogPage })))
const ClockPage = lazy(() => import('@/modules/time/ClockPage').then((m) => ({ default: m.ClockPage })))
const MyShiftPage = lazy(() => import('@/modules/time/MyShiftPage').then((m) => ({ default: m.MyShiftPage })))
const HoursExportPage = lazy(() => import('@/modules/time/HoursExportPage').then((m) => ({ default: m.HoursExportPage })))
const RosterBuilderPage = lazy(() => import('@/modules/roster/RosterBuilderPage').then((m) => ({ default: m.RosterBuilderPage })))
const CertificationRegisterPage = lazy(() => import('@/modules/certifications/CertificationRegisterPage').then((m) => ({ default: m.CertificationRegisterPage })))
const CashSessionPage = lazy(() => import('@/modules/cash/CashSessionPage').then((m) => ({ default: m.CashSessionPage })))
const CashRegisterExceptionsPage = lazy(() => import('@/modules/cash/CashRegisterExceptionsPage').then((m) => ({ default: m.CashRegisterExceptionsPage })))
const IncidentsListPage = lazy(() => import('@/modules/incidents/IncidentsListPage').then((m) => ({ default: m.IncidentsListPage })))
const IncidentDetailPage = lazy(() => import('@/modules/incidents/IncidentDetailPage').then((m) => ({ default: m.IncidentDetailPage })))
const HandoverListPage = lazy(() => import('@/modules/handover/HandoverListPage').then((m) => ({ default: m.HandoverListPage })))
const HandoverDetailPage = lazy(() => import('@/modules/handover/HandoverDetailPage').then((m) => ({ default: m.HandoverDetailPage })))
const DocumentsListPage = lazy(() => import('@/modules/documents/DocumentsListPage').then((m) => ({ default: m.DocumentsListPage })))
const DocumentDetailPage = lazy(() => import('@/modules/documents/DocumentDetailPage').then((m) => ({ default: m.DocumentDetailPage })))
const DocumentAcknowledgmentRegisterPage = lazy(() =>
  import('@/modules/documents/DocumentAcknowledgmentRegisterPage').then((m) => ({ default: m.DocumentAcknowledgmentRegisterPage })),
)
const DashboardPage = lazy(() => import('@/modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const DailyDigestsPage = lazy(() => import('@/modules/dashboard/DailyDigestsPage').then((m) => ({ default: m.DailyDigestsPage })))
const MySelfServicePage = lazy(() => import('@/modules/selfservice/MySelfServicePage').then((m) => ({ default: m.MySelfServicePage })))
const MyLeaveRequestsPage = lazy(() => import('@/modules/selfservice/MyLeaveRequestsPage').then((m) => ({ default: m.MyLeaveRequestsPage })))
const LeaveApprovalsPage = lazy(() => import('@/modules/selfservice/LeaveApprovalsPage').then((m) => ({ default: m.LeaveApprovalsPage })))
const DisputesPage = lazy(() => import('@/modules/selfservice/DisputesPage').then((m) => ({ default: m.DisputesPage })))

export function App() {
  const auth = useAuth()

  if (auth.loading) {
    return <div className="splash">Loading…</div>
  }

  if (auth.mode === 'none') {
    return <SignInForm />
  }

  // A separate component, not a branch inside this one: its hooks (branch,
  // params, pin-cache listeners) must not mount until auth has actually
  // resolved, or their first Firestore request goes out unauthenticated,
  // gets permission-denied, and never retries (Firestore doesn't
  // auto-retry a denied listener) — see the comment in lib/branch.ts.
  return <AuthedShell auth={auth} />
}

function AuthedShell({ auth }: { auth: Extract<AuthState, { mode: 'managed' | 'station' }> }) {
  const activeBranch = useActiveBranch()
  const online = useOnlineStatus()

  // Station device: cache the PIN roster whenever we're online, so PIN
  // entry keeps working the moment wifi drops (docs/03-M0-FOUNDATION.md §5).
  useEffect(() => {
    if (auth.mode !== 'station' || !activeBranch || !online) return
    shouldRefreshPinCache().then((stale) => {
      if (stale) refreshPinCache(activeBranch.branchId)
    })
  }, [auth.mode, activeBranch, online])

  // Photo evidence has no offline durability of its own (Storage isn't
  // Firestore) — this is what makes "uploads on reconnect" true
  // (docs/04-M1-COLDCHAIN.md acceptance criteria).
  useEffect(() => {
    if (online) retryQueuedPhotoUploads()
  }, [online])

  return (
    <div className="app-shell">
      <SideRail />
      <OfflineBanner />
      <header className="app-shell__header">
        <ActorChip />
      </header>
      <main className="app-shell__content">
        <Suspense fallback={<p className="route-loading">Loading…</p>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/parameters" element={<ParamsAdminPage />} />
            <Route path="/coldchain" element={<ColdChainStatusPage />} />
            <Route path="/coldchain/equipment" element={<EquipmentListPage />} />
            <Route path="/coldchain/readings" element={<TakeReadingsPage />} />
            <Route path="/coldchain/excursions/:id" element={<ExcursionDetailPage />} />
            <Route path="/coldchain/quarantine" element={<QuarantinePage />} />
            <Route path="/coldchain/tickets" element={<TicketsPage />} />
            <Route path="/checklists" element={<RunChecklistsPage />} />
            <Route path="/checklists/templates" element={<TemplatesPage />} />
            <Route path="/checklists/runs/:id" element={<RunDetailPage />} />
            <Route path="/exceptions" element={<ExceptionsInboxPage />} />
            <Route path="/logs/queue" element={<QueueEscalationPage />} />
            <Route path="/logs/wastage" element={<WastageLogPage />} />
            <Route path="/logs/receiving" element={<ReceivingLogPage />} />
            <Route path="/time/clock" element={<ClockPage />} />
            <Route path="/time/my-shift" element={<MyShiftPage />} />
            <Route path="/time/export" element={<HoursExportPage />} />
            <Route path="/roster" element={<RosterBuilderPage />} />
            <Route path="/certifications" element={<CertificationRegisterPage />} />
            <Route path="/cash" element={<CashSessionPage />} />
            <Route path="/cash/exceptions" element={<CashRegisterExceptionsPage />} />
            <Route path="/incidents" element={<IncidentsListPage />} />
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
            <Route path="/handover" element={<HandoverListPage />} />
            <Route path="/handover/:id" element={<HandoverDetailPage />} />
            <Route path="/documents" element={<DocumentsListPage />} />
            <Route path="/documents/:id" element={<DocumentDetailPage />} />
            <Route path="/documents-register" element={<DocumentAcknowledgmentRegisterPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/digests" element={<DailyDigestsPage />} />
            <Route path="/self" element={<MySelfServicePage />} />
            <Route path="/self/leave" element={<MyLeaveRequestsPage />} />
            <Route path="/self/disputes" element={<DisputesPage />} />
            <Route path="/leave/approvals" element={<LeaveApprovalsPage />} />
          </Routes>
        </Suspense>
      </main>
      <BottomNav />
    </div>
  )
}
