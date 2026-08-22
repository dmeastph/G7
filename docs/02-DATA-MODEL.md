# 02 — Data model

Top-level collections with a `branchId` field, rather than subcollections under `branches/`. Simpler security rules, and cross-branch reporting later needs no `collectionGroup` gymnastics.

## Fields every operational document carries

```ts
type OperationalBase = {
  branchId: string
  businessDayId: string | null
  shiftInstanceId: string | null
  actorId: string          // who — from PIN or managed account
  actorName: string        // denormalised; people leave, records stay readable
  createdAt: Timestamp
  deviceId: string
  correctsId?: string      // this document corrects another
  correctionReason?: string
}
```

Stamped by `writeOperational()`. Never by hand.

---

## M0 collections

### `branches/{branchId}`
```ts
{
  code: '001', name: 'Imus',
  operatingMode: 'scheduled' | '24_7',
  openTime: '06:00', closeTime: '24:00',
  businessDayCutoff: '24:00',        // becomes '04:00' at 24/7
  timezone: 'Asia/Manila',
  address: string, status: 'active' | 'closed'
}
```

### `users/{userId}`
```ts
{
  employeeNo: string, displayName: string,
  roles: RoleCode[],                 // ['cashier'] | ['shift_leader'] | ...
  branchIds: string[],
  pinHash: string,                   // bcrypt, cost >= 10
  authUid: string | null,            // set for managed accounts only
  status: 'active' | 'inactive',
  certifications: {                  // populated by M3; M0 defines the shape
    [level: string]: { certifiedAt: Timestamp, expiresAt: Timestamp | null, assessorId: string }
  },
  hiredAt: Timestamp, createdAt: Timestamp
}
```
**Never store a plaintext PIN. Never expose `pinHash` outside the station PIN cache read.**

### `roles/{roleCode}`
`owner · ops_head · store_manager · shift_leader · cashier · kitchen_staff · store_staff · auditor · trainer · technician`
```ts
{ name: string, permissions: string[], level: number }
```
Permission codes are dotted: `cash.approve_void`, `stock.release_quarantine`, `param.edit`, `equipment.manage`.

### `parameters/{paramId}`
```ts
{
  key: string,                       // 'cash.drawer_max_balance'
  scope: 'global' | 'branch' | 'shift_template',
  scopeId: string | null,
  value: number | string | boolean | null,   // null = deliberately unset
  dataType: 'currency' | 'number' | 'duration_minutes' | 'temperature_c' | 'time' | 'boolean' | 'enum',
  minAllowed: number | null, maxAllowed: number | null,
  unit: string | null,
  ownerRole: RoleCode,
  effectiveFrom: Timestamp, effectiveTo: Timestamp | null,
  changedBy: string, changedAt: Timestamp, reason: string,
  requiresProfessionalSignoff: boolean       // true = a food-safety or legal value
}
```

**Historical values are retained, never overwritten.** A change writes a new document and sets `effectiveTo` on the old one. Investigating a variance from three weeks ago needs the limit *as it was then*.

**`value: null` means deliberately unset.** The UI must show "not set — see Manual Appendix D", never a default. Writing a fabricated value into a `requiresProfessionalSignoff` parameter is the single worst thing this system could do.

### `auditLog/{id}`
```ts
{ entity: string, entityId: string, action: 'create'|'correct'|'approve'|'close'|'param_change',
  before: object | null, after: object | null,
  actorId: string, actorName: string, at: Timestamp, deviceId: string, branchId: string }
```
Append-only. No client delete or update. Ever.

### `businessDays/{id}` — id `{branchId}_{YYYY-MM-DD}`
```ts
{ branchId, businessDate: 'YYYY-MM-DD', opensAt: Timestamp, closesAt: Timestamp,
  status: 'open' | 'closed', closedBy: string | null, closedAt: Timestamp | null }
```
Boundaries derive from `branch.businessDayCutoff`. In 24/7 mode the business day will **not** match the calendar day — never assume it does.

### `shiftTemplates/{id}`
```ts
{ branchId, name: 'Morning'|'Evening'|'Overnight', startTime: '06:00', endTime: '15:00',
  targetHeadcount: { min: 2, max: 3 }, active: boolean }
```

### `shiftInstances/{id}`
```ts
{ branchId, businessDayId, templateId, templateName,
  plannedStart: Timestamp, plannedEnd: Timestamp,
  actualStart: Timestamp | null, actualEnd: Timestamp | null,
  status: 'planned' | 'active' | 'closed',
  leaderId: string | null }
```
**This is the universal anchor.** Every operational record points at a shift instance. It is what makes "who was on duty when this went wrong" a one-query answer.

---

## M1 collections

### `equipment/{id}`
```ts
{
  branchId, assetId: 'CH-01',      // human-facing, printed on the unit
  type: 'chiller'|'freezer'|'chest_freezer'|'undercounter'|'cooker'|'microwave'|'rice_cooker'|'hot_hold'|'fryer'|'aircon'|'other',
  make, model, serial, supplier,
  purchaseDate, warrantyExpiry: Timestamp | null,
  zone: string, status: 'active'|'out_of_service'|'retired',
  requiresTemperatureLog: boolean,
  thresholds: { minC: number | null, maxC: number | null, maxExcursionMinutes: number | null } | null,
  thresholdSource: string,          // 'Manual Appendix G' | 'manufacturer' | 'unset'
  notes: string
}
```
`thresholds: null` or any `null` inside it means **unset**. The reading screen shows "target not set" and still records the number. It must never block logging.

### `temperatureReadings/{id}`
```ts
OperationalBase & {
  equipmentId: string, assetId: string,
  valueC: number,                   // the real number, always
  readAt: Timestamp, method: 'manual'|'probe'|'sensor',
  photoRef: string | null,
  withinRange: boolean | null,      // null when thresholds unset
  scheduledSlot: string | null,     // '06:00' | '09:00' | ...
  duplicateFlag: boolean            // two readings, same unit, same slot
}
```

### `excursions/{id}`
```ts
OperationalBase & {
  equipmentId, assetId,
  startedAt: Timestamp, endedAt: Timestamp | null,
  startReadingId: string, peakC: number, durationMinutes: number | null,
  autoDetected: boolean,
  firstChecks: {                    // the seven checks from Manual F/I
    doorOpen: boolean, overloaded: boolean, iceBuildup: boolean,
    defrostCycle: boolean, powerInterruption: boolean,
    gasketDamaged: boolean, setpointChanged: boolean,
    nothingFound: boolean, detail: string
  } | null,
  status: 'open'|'recovered'|'quarantined'|'closed',
  exceptionId: string | null, ticketId: string | null,
  closedBy: string | null, closedAt: Timestamp | null, closureNote: string
}
```

### `quarantineLots/{id}`
```ts
OperationalBase & {
  excursionId, itemName, lot: string | null, qty: number, unit: string,
  estValueCentavos: number | null, location: string,
  status: 'quarantined'|'released'|'discarded'|'returned'|'pending_technician',
  disposition: { outcome, basis: string, decidedBy: string, decidedAt: Timestamp,
                 evidenceRefs: string[], wastageRecordId: string | null } | null
}
```
**`status: 'quarantined'` must block sale.** There is no POS integration yet, so M1 enforces it in the UI: quarantined lots appear on the dashboard and the shift handover until dispositioned, and **only a user with `stock.release_quarantine` can set `released`.** That permission belongs to `store_manager` and `owner` only.

### `maintenanceTickets/{id}`
```ts
OperationalBase & {
  equipmentId, assetId, symptom: string,
  tradeImpact: 'none'|'reduced'|'stopped', stockAtRisk: boolean,
  reportedAt: Timestamp,
  technician: string | null, calledAt, attendedAt: Timestamp | null,
  diagnosis: string, workDone: string, partsReplaced: string,
  underWarranty: boolean | null, costCentavos: number | null, invoiceRef: string,
  downtimeMinutes: number | null, preventiveAdvice: string,
  status: 'open'|'attended'|'closed',
  verifiedWorkingBy: string | null, closedAt: Timestamp | null
}
```
**A ticket cannot be closed without `verifiedWorkingBy`.** A ticket closed on a technician's word alone is how the same fault returns three weeks later.

### `exceptions/{id}` — the universal work item
```ts
OperationalBase & {
  source: 'temperature'|'checklist'|'cash'|'incident'|'maintenance'|'manual',
  sourceId: string, severity: 'low'|'medium'|'high'|'critical',
  title: string, detail: string,
  ownerRole: RoleCode, ownerId: string | null,
  dueAt: Timestamp | null,
  status: 'open'|'in_progress'|'resolved'|'escalated',
  carriedForwardCount: number,      // 3 or more escalates to the Store Manager
  correctiveAction: { action, byId, atTime, verifiedById, verifiedAt } | null
}
```
Introduced in M1, consumed by every module after it. Get it right here.

### `dailySummaries/{id}` — id `{branchId}_{YYYY-MM-DD}`
Written by a Cloud Function on business-day close. Dashboards read **this**, never raw records.
```ts
{ branchId, businessDate, computedAt,
  temperature: { readingsDue, readingsTaken, missed, excursionsOpened, excursionsOpen },
  quarantine: { lotsOpen, estValueCentavos },
  maintenance: { ticketsOpen, ticketsOpened, ticketsClosed },
  exceptions: { opened, closed, openTotal, overdue },
  staffing: { shiftsPlanned, shiftsShort } }
```

---

## Security rules — the shape

```
function claims() { return request.auth.token; }
function sameBranch(b) { return claims().branchId == b; }
function hasRole(r) { return claims().role == r; }
function isManager() { return hasRole('store_manager') || hasRole('owner') || hasRole('ops_head'); }
function isStation() { return hasRole('station'); }

// operational writes: create only, never update or delete
match /temperatureReadings/{id} {
  allow read:   if request.auth != null && sameBranch(resource.data.branchId);
  allow create: if request.auth != null
                && sameBranch(request.resource.data.branchId)
                && request.resource.data.actorId is string
                && request.resource.data.createdAt == request.time;
  allow update, delete: if false;
}

match /quarantineLots/{id} {
  allow create: if isStation() || isManager();
  allow update: if isManager()
                && request.resource.data.status in ['released','discarded','returned','pending_technician'];
  allow delete: if false;
}

match /parameters/{id} {
  allow read:   if request.auth != null;
  allow write:  if isManager();
}

match /auditLog/{id} {
  allow read:   if isManager();
  allow create: if request.auth != null;
  allow update, delete: if false;
}

match /users/{id} {
  allow read:   if isManager() || request.auth.uid == resource.data.authUid;
  allow write:  if isManager();
}
```

**Test these in the emulator before shipping.** Write rules tests for at least: station cannot release quarantine · nobody can update a temperature reading · nobody can delete an audit entry · a station account cannot read another branch.

## Indexes

Composite indexes needed — declare them in `firestore.indexes.json`:

- `temperatureReadings`: `branchId ASC, equipmentId ASC, readAt DESC`
- `temperatureReadings`: `branchId ASC, businessDayId ASC, readAt ASC`
- `excursions`: `branchId ASC, status ASC, startedAt DESC`
- `exceptions`: `branchId ASC, status ASC, dueAt ASC`
- `quarantineLots`: `branchId ASC, status ASC, createdAt DESC`
- `maintenanceTickets`: `branchId ASC, status ASC, reportedAt DESC`
