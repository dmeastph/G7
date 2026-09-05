// Single source of truth for Firestore document shapes — see docs/02-DATA-MODEL.md.
// M2+ collections are added when those modules are built, not speculatively here.
import type { Timestamp } from 'firebase/firestore'

export type RoleCode =
  | 'owner'
  | 'ops_head'
  | 'store_manager'
  | 'shift_leader'
  | 'cashier'
  | 'kitchen_staff'
  | 'store_staff'
  | 'auditor'
  | 'trainer'
  | 'technician'
  | 'station'

// Stamped by writeOperational() — never assembled by hand in a component.
export type OperationalBase = {
  branchId: string
  businessDayId: string | null
  shiftInstanceId: string | null
  actorId: string
  actorName: string
  createdAt: Timestamp
  deviceId: string
  correctsId?: string
  correctionReason?: string
}

export type Branch = {
  code: string
  name: string
  operatingMode: 'scheduled' | '24_7'
  openTime: string
  closeTime: string
  businessDayCutoff: string
  timezone: string
  address: string
  status: 'active' | 'closed'
}

export type Certification = {
  certifiedAt: Timestamp
  expiresAt: Timestamp | null
  assessorId: string
}

export type User = {
  employeeNo: string
  displayName: string
  roles: RoleCode[]
  branchIds: string[]
  pinHash: string
  authUid: string | null
  status: 'active' | 'inactive'
  certifications: Record<string, Certification>
  hiredAt: Timestamp
  createdAt: Timestamp
}

export type Role = {
  name: string
  permissions: string[]
  level: number
}

export type ParamDataType =
  | 'currency'
  | 'number'
  | 'duration_minutes'
  | 'temperature_c'
  | 'time'
  | 'boolean'
  | 'enum'

export type Parameter = {
  key: string
  scope: 'global' | 'branch' | 'shift_template'
  scopeId: string | null
  value: number | string | boolean | null
  dataType: ParamDataType
  minAllowed: number | null
  maxAllowed: number | null
  unit: string | null
  ownerRole: RoleCode
  effectiveFrom: Timestamp
  effectiveTo: Timestamp | null
  changedBy: string
  changedAt: Timestamp
  reason: string
  requiresProfessionalSignoff: boolean
}

export type AuditAction = 'create' | 'correct' | 'approve' | 'close' | 'param_change' | 'role_change' | 'pin_reset'

export type AuditLogEntry = {
  entity: string
  entityId: string
  action: AuditAction
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actorId: string
  actorName: string
  at: Timestamp
  deviceId: string
  branchId: string
}

export type BusinessDay = {
  branchId: string
  businessDate: string // YYYY-MM-DD
  opensAt: Timestamp
  closesAt: Timestamp
  status: 'open' | 'closed'
  closedBy: string | null
  closedAt: Timestamp | null
}

export type ShiftTemplate = {
  branchId: string
  name: string
  startTime: string
  endTime: string
  targetHeadcount: { min: number; max: number }
  active: boolean
}

export type ShiftInstance = {
  branchId: string
  businessDayId: string
  templateId: string
  templateName: string
  plannedStart: Timestamp
  plannedEnd: Timestamp
  actualStart: Timestamp | null
  actualEnd: Timestamp | null
  status: 'planned' | 'active' | 'closed'
  leaderId: string | null
}

// ---- M1 — cold chain and equipment (docs/04-M1-COLDCHAIN.md) ----

export type EquipmentType =
  | 'chiller'
  | 'freezer'
  | 'chest_freezer'
  | 'undercounter'
  | 'cooker'
  | 'microwave'
  | 'rice_cooker'
  | 'hot_hold'
  | 'fryer'
  | 'aircon'
  | 'other'

export type EquipmentThresholds = {
  minC: number | null
  maxC: number | null
  maxExcursionMinutes: number | null
}

export type Equipment = {
  branchId: string
  assetId: string // human-facing, printed on the unit, e.g. 'CH-01'
  type: EquipmentType
  make: string
  model: string
  serial: string
  supplier: string
  purchaseDate: Timestamp | null
  warrantyExpiry: Timestamp | null
  zone: string
  status: 'active' | 'out_of_service' | 'retired'
  requiresTemperatureLog: boolean
  // null (or any null field inside it) means unset — never invent one, and
  // never let it block a reading.
  thresholds: EquipmentThresholds | null
  thresholdSource: string // 'Manual Appendix G' | 'manufacturer' | 'unset'
  notes: string
}

export type TemperatureReading = OperationalBase & {
  equipmentId: string
  assetId: string
  valueC: number
  readAt: Timestamp
  method: 'manual' | 'probe' | 'sensor'
  photoRef: string | null
  withinRange: boolean | null // null when thresholds unset
  scheduledSlot: string | null // '06:00' | '09:00' | ...
  duplicateFlag: boolean
}

export type ExcursionFirstChecks = {
  doorOpen: boolean
  overloaded: boolean
  iceBuildup: boolean
  defrostCycle: boolean
  powerInterruption: boolean
  gasketDamaged: boolean
  setpointChanged: boolean
  nothingFound: boolean
  detail: string
}

export type Excursion = OperationalBase & {
  equipmentId: string
  assetId: string
  startedAt: Timestamp
  endedAt: Timestamp | null
  startReadingId: string
  peakC: number
  durationMinutes: number | null
  autoDetected: boolean
  firstChecks: ExcursionFirstChecks | null
  status: 'open' | 'recovered' | 'quarantined' | 'closed'
  exceptionId: string | null
  ticketId: string | null
  closedBy: string | null
  closedAt: Timestamp | null
  closureNote: string
}

export type QuarantineDisposition = {
  outcome: 'released' | 'discarded' | 'returned' | 'pending_technician'
  basis: string
  decidedBy: string
  decidedAt: Timestamp
  evidenceRefs: string[]
  wastageRecordId: string | null
}

export type QuarantineLot = OperationalBase & {
  excursionId: string
  itemName: string
  lot: string | null
  qty: number
  unit: string
  estValueCentavos: number | null
  location: string
  status: 'quarantined' | 'released' | 'discarded' | 'returned' | 'pending_technician'
  disposition: QuarantineDisposition | null
}

export type MaintenanceTicket = OperationalBase & {
  equipmentId: string
  assetId: string
  symptom: string
  tradeImpact: 'none' | 'reduced' | 'stopped'
  stockAtRisk: boolean
  reportedAt: Timestamp
  technician: string | null
  calledAt: Timestamp | null
  attendedAt: Timestamp | null
  diagnosis: string
  workDone: string
  partsReplaced: string
  underWarranty: boolean | null
  costCentavos: number | null
  invoiceRef: string
  downtimeMinutes: number | null
  preventiveAdvice: string
  status: 'open' | 'attended' | 'closed'
  verifiedWorkingBy: string | null
  closedAt: Timestamp | null
}

export type ExceptionCorrectiveAction = {
  action: string
  byId: string
  atTime: Timestamp
  verifiedById: string | null
  verifiedAt: Timestamp | null
}

export type ExceptionRecord = OperationalBase & {
  source: 'temperature' | 'checklist' | 'cash' | 'incident' | 'maintenance' | 'manual'
  sourceId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  detail: string
  ownerRole: RoleCode
  ownerId: string | null
  dueAt: Timestamp | null
  status: 'open' | 'in_progress' | 'resolved' | 'escalated'
  carriedForwardCount: number
  correctiveAction: ExceptionCorrectiveAction | null
  // Not in the original M1 shape — added in M2 so carry-forward
  // reconciliation (docs/07-M2-CHECKLISTS.md) is idempotent per business
  // day without mutating businessDayId itself, which must keep meaning
  // "the day this was raised."
  lastCarriedForwardBusinessDayId: string | null
}

// ---- M2 — checklists and exceptions (docs/07-M2-CHECKLISTS.md) ----

export type ChecklistCategory = 'opening' | 'closing' | 'ramyeon_station' | 'dining' | 'general'
export type ChecklistItemType = 'pass_fail' | 'numeric' | 'photo' | 'text'

export type ChecklistItem = {
  id: string
  label: string
  type: ChecklistItemType
  required: boolean
  numericMin: number | null
  numericMax: number | null
}

export type ChecklistTemplate = {
  branchId: string
  name: string
  category: ChecklistCategory
  version: number
  active: boolean
  items: ChecklistItem[]
  createdBy: string
  createdAt: Timestamp
}

export type ChecklistRun = OperationalBase & {
  templateId: string
  templateVersion: number
  templateName: string
  category: ChecklistCategory
  scheduledSlot: string | null
  dueAt: Timestamp
  status: 'due' | 'overdue' | 'missed' | 'in_progress' | 'completed'
  startedAt: Timestamp | null
  completedAt: Timestamp | null
  completedBy: string | null
  itemCount: number
  passCount: number
  failCount: number
}

export type ChecklistResponse = OperationalBase & {
  runId: string
  itemId: string
  itemLabel: string
  type: ChecklistItemType
  valueBool: boolean | null
  valueNumber: number | null
  valueText: string | null
  photoRef: string | null
  withinRange: boolean | null
  passed: boolean
}

export type QueueEscalation = OperationalBase & {
  queueLength: number
  action: string
  resolvedAt: Timestamp | null
}

export type WastageRecord = OperationalBase & {
  source: 'quarantine' | 'checklist' | 'manual'
  sourceId: string | null
  itemName: string
  qty: number
  unit: string
  estValueCentavos: number | null
  reason: string
}

export type ReceivingItem = {
  name: string
  qtyOrdered: number
  qtyReceived: number
  condition: 'ok' | 'damaged' | 'short' | 'wrong_item'
}

export type ReceivingRecord = OperationalBase & {
  supplier: string
  deliveryRef: string
  items: ReceivingItem[]
  temperatureCheckC: number | null
  discrepancyNoted: boolean
  discrepancyNote: string
}

// ---- M3 — time, roster and certification (docs/08-M3-TIME-ROSTER-CERTIFICATION.md) ----

export type TimeEntry = OperationalBase & {
  userId: string
  userName: string
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
  at: Timestamp
  photoRef: string | null
  method: 'station' | 'correction'
}

export type RosterAssignment = OperationalBase & {
  // businessDayId comes from OperationalBase (stamped by writeOperational);
  // not redeclared here to avoid an intersection with a narrower type.
  shiftInstanceId: string
  userId: string
  userName: string
  role: RoleCode
  status: 'planned' | 'confirmed' | 'cancelled'
}

// ---- M4 — cash control (docs/09-M4-CASH-CONTROL.md) ----

export type CashSession = OperationalBase & {
  userId: string
  userName: string
  openedAt: Timestamp
  openingFloatCentavos: number
  status: 'open' | 'closed'
  closedAt: Timestamp | null
}

export type CashDrop = OperationalBase & {
  sessionId: string
  amountCentavos: number
  bagNumber: string
  status: 'dropped' | 'received'
  receivedBy: string | null
  receivedAt: Timestamp | null
}

// expectedCentavos stays null until a separate reveal action sets it — that
// gap is the blind count, not an oversight (docs/09-M4-CASH-CONTROL.md §4-5).
export type CashCloseCount = OperationalBase & {
  sessionId: string
  countedCentavos: number
  countedAt: Timestamp
  countedBy: string
  expectedCentavos: number | null
  revealedBy: string | null
  revealedAt: Timestamp | null
  varianceCentavos: number | null
  requiresInvestigation: boolean
  investigationNote: string
  status: 'counted' | 'revealed'
}

export type CashRegisterExceptionType = 'void' | 'refund' | 'override' | 'no_sale'

// A log, not an enforcement point — the void/refund/override happens on
// the POS this system doesn't touch; this records that it happened.
export type CashRegisterException = OperationalBase & {
  sessionId: string
  type: CashRegisterExceptionType
  amountCentavos: number | null
  reason: string
  approvalRequired: boolean
  approvedBy: string | null
  approvedAt: Timestamp | null
}

// ---- M5 — incidents (docs/10-M5-INCIDENTS.md) ----

export type IncidentType = 'theft' | 'injury' | 'altercation' | 'property_damage' | 'safety' | 'security' | 'other'

export type IncidentRecord = OperationalBase & {
  type: IncidentType
  severity: 'low' | 'medium' | 'high' | 'critical'
  occurredAt: Timestamp
  narrative: string
  immediateAction: string
  status: 'open' | 'escalated' | 'closed'
  exceptionId: string | null
  rootCause: string
  closedBy: string | null
  closedAt: Timestamp | null
}

// One document per preservation action, not an array of clips on the
// incident — each has its own person, timestamp and chain of custody, same
// reasoning as cashDrops (docs/10-M5-INCIDENTS.md). clipRef is a string a
// human types pointing at wherever the export lives — this system never
// touches the footage itself.
export type CctvPreservation = OperationalBase & {
  incidentId: string
  cameras: string[]
  rangeStart: Timestamp
  rangeEnd: Timestamp
  clipRef: string
  retainUntil: Timestamp
}

// ---- M6 — shift handover (docs/11-M6-SHIFT-HANDOVER.md) ----

export type HandoverPackExceptionItem = {
  exceptionId: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  source: string
  // Computed at generation time by looking at the two immediately preceding
  // handovers for this branch, never stored on the exception itself — see
  // docs/11-M6-SHIFT-HANDOVER.md "Why this carry-forward is not M2's
  // carry-forward" for why this is a separate mechanism from
  // exceptions.carriedForwardCount.
  carriedShiftCount: number
}

export type HandoverPack = {
  generatedAt: Timestamp
  openExceptions: HandoverPackExceptionItem[]
  openIncidentCount: number
  openTicketCount: number
  cashSessionsStillOpen: number
  checklistsCompletedToday: number
  checklistsMissedToday: number
}

// A frozen snapshot, not a live view — the incoming leader reviews what the
// outgoing leader actually saw, not a number that drifted while they read
// it (docs/11-M6-SHIFT-HANDOVER.md "Generating a pack").
export type ShiftHandover = OperationalBase & {
  shiftInstanceId: string
  pack: HandoverPack
  status: 'pending' | 'accepted'
  acceptedBy: string | null
  acceptedByName: string | null
  acceptedAt: Timestamp | null
  incomingNote: string
}

// ---- M7 — document control (docs/12-M7-DOCUMENT-CONTROL.md) ----

export type DocumentCategory = 'manual' | 'sop' | 'policy' | 'form' | 'other'

// Not OperationalBase — manager-configured reference data, same reasoning
// as checklistTemplates and equipment, not a floor event. A new version is
// a new document, exactly like checklistTemplates' own versioning.
export type DocumentRecord = {
  branchId: string
  branchApplicability: string[] | null
  code: string
  title: string
  category: DocumentCategory
  version: number
  active: boolean
  fileRef: string
  fileSizeBytes: number
  supersedesId: string | null
  createdBy: string
  createdAt: Timestamp
}

// Append-only — actorId/actorName (from OperationalBase) already carry who
// acknowledged, no separate field duplicating that.
export type DocumentAcknowledgment = OperationalBase & {
  documentId: string
  documentCode: string
}

// ---- M8 — dashboard and daily digest (docs/13-M8-DASHBOARD-DIGEST.md) ----

// Write-never from a client — only closeBusinessDay (Cloud Function, Admin
// SDK) produces these. Extends the shape docs/02-DATA-MODEL.md specified
// back in M1 with the two sections that didn't exist yet then (cash didn't
// exist until M4, certifications until M3).
export type DailySummary = {
  branchId: string
  businessDate: string
  computedAt: Timestamp
  temperature: { readingsDue: number; readingsTaken: number; missed: number; excursionsOpened: number; excursionsOpen: number }
  quarantine: { lotsOpen: number; estValueCentavos: number }
  maintenance: { ticketsOpen: number; ticketsOpened: number; ticketsClosed: number }
  exceptions: { opened: number; closed: number; openTotal: number; overdue: number }
  staffing: { shiftsPlanned: number; shiftsShort: number }
  cash: { sessionsOpenAtClose: number; totalVarianceCentavos: number; unresolvedInvestigations: number }
  certifications: { expiringCount: number | null } // null when staff.certification_expiry_warning_days is unset
}

// ---- M9 — employee self-service and leave (docs/14-M9-EMPLOYEE-SELF-SERVICE.md) ----

export type LeaveType = 'company' | 'statutory_sil'

export type LeaveCoverageItem = {
  shiftInstanceId: string
  templateName: string
  date: string
  assignedCount: number
  minRequired: number
  wouldBeShort: boolean
}

// userId/userName here are resolved via the requester's users.authUid link,
// not actorId — a personal login's actorId is their Firebase UID, which is
// not the same identity space as the PIN-cache userId their timeEntries and
// rosterAssignments use. See docs/14-M9-EMPLOYEE-SELF-SERVICE.md "The
// identity problem this spec exists to solve".
export type LeaveRequest = OperationalBase & {
  userId: string
  userName: string
  type: LeaveType
  startDate: string
  endDate: string
  reason: string
  // Frozen at submission, never recomputed on read — same reasoning as
  // M6's handover pack.
  coverageSnapshot: LeaveCoverageItem[]
  status: 'pending' | 'approved' | 'denied'
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: Timestamp | null
  decisionNote: string
}

export type TimeEntryDispute = OperationalBase & {
  userId: string
  userName: string
  timeEntryId: string
  reason: string
  status: 'open' | 'resolved'
  resolvedBy: string | null
  resolvedByName: string | null
  resolvedAt: Timestamp | null
  correctionEntryId: string | null
}

// ---- M10 — item master bridge (docs/15-M10-ITEM-MASTER.md) ----

// Not OperationalBase — this is synced reference data mirrored from
// g7-pos, not a floor event with a businessDayId/shiftInstanceId. Synced
// fields come from the last sync and are never hand-edited here;
// operational fields are g7-ops's own and survive every future sync
// untouched.
export type ItemDoc = {
  sourceItemId: string // g7-pos's own document ID — the join key, not SKU
  sku: string
  barcode: string | null
  name: string
  category: string
  priceCentavos: number
  vatClass: 'vatable' | 'vat_exempt' | 'zero_rated'
  presentInLatestExport: boolean // false = missing from the most recent sync — flagged, never deleted

  reorderPoint: number | null
  defaultSupplierId: string | null // null until M12 (suppliers) exists
  unitOfPurchase: string | null // e.g. "case of 24" — free text until a real need for structure shows up

  active: boolean
  lastSyncedAt: Timestamp | null // null until the first successful sync
  createdAt: Timestamp
}

// One per sync run, not per item — written only by runCatalogueSync
// (Cloud Function, Admin SDK), whether fired by an accepted handover or
// the manual "Sync now" button. A failed run still writes one of these,
// with status 'failed' and no items touched.
export type CatalogueSyncDoc = {
  trigger: 'handover' | 'manual'
  triggeredBy: string | null
  triggeredByName: string | null
  handoverId: string | null // set only when trigger === 'handover'
  sourceExportedAt: string | null // g7-pos's own export timestamp; null on a failed run
  status: 'ok' | 'failed'
  errorMessage: string | null
  newCount: number
  changedCount: number
  missingCount: number
  createdAt: Timestamp
}
