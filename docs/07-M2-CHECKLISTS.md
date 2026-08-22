# 07 — M2 · Checklists and exceptions

**Build this third.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M1 gave the store one instrument — temperature. M2 gives it the rest of the floor: opening and closing routines, the 20/30/60-minute walk-arounds the manual already requires, and the exception engine that M1 started but didn't finish (a place to see and close out everything that's gone wrong, not just cold-chain incidents).

**M2 must work with M0 and M1 present, not couple further forward.** No roster, no cash, no handover.

## What it does

1. Versioned checklist templates
2. Scheduled runs — opening, closing, and periodic checks (ramyeon station 30 min, dining 20 min, general 60 min)
3. Pass/fail, numeric, photo and text responses per item
4. Missed-run detection
5. The exception engine, completed — an inbox, corrective actions, carry-forward escalation
6. Three small logs: queue escalation, wastage, receiving

## Data model additions

### `checklistTemplates/{id}`
```ts
{
  branchId, name: string,
  category: 'opening' | 'closing' | 'ramyeon_station' | 'dining' | 'general',
  version: number, active: boolean,
  items: Array<{
    id: string, label: string,
    type: 'pass_fail' | 'numeric' | 'photo' | 'text',
    required: boolean,
    numericMin: number | null, numericMax: number | null,   // numeric items only; null = no bound
  }>,
  createdBy: string, createdAt: Timestamp,
}
```
**Versioned like parameters, not overwritten.** Editing a template deactivates the old version (`active: false`) and creates a new one. A run always carries `templateVersion`, so a run from three weeks ago still shows the checklist as it was that day.

### `checklistRuns/{id}`
```ts
OperationalBase & {
  templateId, templateVersion: number, templateName, category,
  scheduledSlot: string | null,        // '06:00' for opening, interval slot label for periodic checks
  dueAt: Timestamp,
  status: 'due' | 'overdue' | 'missed' | 'in_progress' | 'completed',
  startedAt: Timestamp | null, completedAt: Timestamp | null, completedBy: string | null,
  itemCount: number, passCount: number, failCount: number,
}
```
Same due/overdue/missed slot logic as M1's temperature readings — literally the same `generateSlots`/`slotStatus` functions (moved to `lib/slots.ts` since two domains now use them). Opening and closing are single runs per business day, due at `businessDay.opensAt` / `businessDay.closesAt`. Periodic categories get one run per interval slot across the trading day.

### `checklistResponses/{id}`
```ts
OperationalBase & {
  runId, itemId, itemLabel, type: 'pass_fail' | 'numeric' | 'photo' | 'text',
  valueBool: boolean | null, valueNumber: number | null, valueText: string | null,
  photoRef: string | null,
  withinRange: boolean | null,   // numeric items with bounds set; null otherwise
  passed: boolean,               // derived — false only on an explicit fail or an out-of-range numeric
}
```
Append-only, exactly like `temperatureReadings`. One response per item per run; a re-answer is a new response document, not an edit — the run shows the latest per item.

### `queueEscalations/{id}`
```ts
OperationalBase & { queueLength: number, action: string, resolvedAt: Timestamp | null }
```
Logged when `service.queue_second_till_threshold` (seeded, 5) is exceeded. `action` is free text — "opened second till", "called for backup". Any signed-in same-branch user can log and later mark it resolved; this is a floor action, not a manager approval.

### `wastageRecords/{id}`
```ts
OperationalBase & {
  source: 'quarantine' | 'checklist' | 'manual', sourceId: string | null,
  itemName: string, qty: number, unit: string,
  estValueCentavos: number | null, reason: string,
}
```
This is what `quarantineLots.disposition.wastageRecordId` (stubbed `null` in M1) now points to when the outcome is `discarded` — M1 said "stub in M1; M2 completes it," and this is that completion.

### `receivingRecords/{id}`
```ts
OperationalBase & {
  supplier: string, deliveryRef: string,
  items: Array<{ name: string, qtyOrdered: number, qtyReceived: number, condition: 'ok' | 'damaged' | 'short' | 'wrong_item' }>,
  temperatureCheckC: number | null,
  discrepancyNoted: boolean, discrepancyNote: string,
}
```
`receivedBy` is not a separate field — it's `actorName`, already stamped by `writeOperational`.

### `exceptions` — completing it
No shape change from M1. What M2 adds is behaviour:
- **An inbox screen** — list by status/severity/source, with a corrective-action form (`action`, `verifiedById`, `verifiedAt`) that resolves it.
- **Carry-forward escalation.** On viewing the inbox, any exception still `open`/`in_progress` from a *previous* business day gets `carriedForwardCount` incremented (once per distinct past day it survives) and, at 3, `ownerRole` reassigned to `store_manager` and `status` set to `escalated`. Client-triggered reconciliation, same honest limitation as M1's missed-reading detection — a scheduled Cloud Function would catch it even if nobody opens the app, and is out of scope here.

## Screens

### 1 · Checklist templates (manager only)
List by category, create/edit (which versions), item builder (label, type, required, numeric bounds). Crew read nothing here — they only ever see runs, not template management.

### 2 · Run a checklist
Same shape as M1's "take readings": due/overdue/missed tiles per category. Tap in → step through items one at a time → pass/fail buttons, numeric keypad, photo capture, or text field per item type → progress bar → complete. **No pre-filling, same reasoning as temperature readings** — a checklist run full of identical answers is the same falsified-record risk.

Numeric items outside their bounds don't block the run — they just don't count as `passed`, and the item is visibly flagged, same "flag, don't block" philosophy as M1's duplicate-reading rule.

### 3 · Exceptions inbox
Filterable list (status, severity, source — cold-chain excursions/missed readings from M1 show up here too, since they already write to `exceptions`). Tap in → corrective action form → resolve.

### 4 · Queue escalation
One button: log a queue escalation (current queue length, action taken). List of open ones with a "resolve" tap.

### 5 · Wastage log
List + record entry. When reached from a quarantine disposition, pre-fills item/qty/value and writes the link back.

### 6 · Receiving
Record a delivery: supplier, items with ordered vs received qty and condition, optional temperature check, discrepancy note.

## Logic

**Slot generation.** Identical mechanism to M1: `generateSlots(start, end, intervalMinutes)` then `slotStatus(slot, now, graceMinutes, hasRun)`. Opening/closing use a single "slot" spanning the whole business day. Periodic categories use `clean.ramyeon_station_interval_minutes` (30), `clean.dining_check_interval_minutes` (20), `clean.general_check_interval_minutes` (60) — all three already seeded in M0.

**Missed-run detection.** Same pattern as M1's missed-reading exceptions: client-side, on viewing the relevant screen, dedup by a deterministic `sourceId` (`{templateId}::{businessDayId}::{slot}`) before creating a `medium` exception.

**Run lifecycle.** `due`/`overdue`/`missed` until first response, then `in_progress`; `completed` once every required item has a response. A completed run is never reopened — a correction is a new response for that item, same append-only reasoning as everywhere else.

**Wastage linkage.** Discarding a quarantine lot (`QuarantineDispositionDialog`, M1) now also writes a `wastageRecords` entry and sets `disposition.wastageRecordId` on the lot in the same action.

## Security rules — the shape

```
match /checklistTemplates/{id} {
  allow read:          if signedIn() && sameBranch(resource.data.branchId);
  allow create, update: if isManager() && sameBranch(request.resource.data.branchId);
  allow delete:         if false;
}

match /checklistRuns/{id} {
  allow read:   if signedIn() && (resource == null || sameBranch(resource.data.branchId));
  allow create: if signedIn() && sameBranch(request.resource.data.branchId);
  allow update: if signedIn() && sameBranch(resource.data.branchId);   // crew progresses their own run
  allow delete: if false;
}

match /checklistResponses/{id} {
  allow read:            if signedIn() && sameBranch(resource.data.branchId);
  allow create:          if signedIn() && sameBranch(request.resource.data.branchId)
                           && request.resource.data.actorId is string
                           && request.resource.data.createdAt == request.time;
  allow update, delete:  if false;   // append-only, same as temperatureReadings
}

match /queueEscalations/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if signedIn() && sameBranch(resource.data.branchId);   // resolvedAt only, in practice
  allow delete: if false;
}

match /wastageRecords/{id} {
  allow read:            if signedIn() && sameBranch(resource.data.branchId);
  allow create:          if (isStation() || isManager()) && sameBranch(request.resource.data.branchId) && /* stamps */;
  allow update, delete:  if false;
}

match /receivingRecords/{id} {
  allow read:            if signedIn() && sameBranch(resource.data.branchId);
  allow create:          if (isStation() || isManager()) && sameBranch(request.resource.data.branchId) && /* stamps */;
  allow update, delete:  if false;
}
```

## Acceptance criteria

**Templates**
- [ ] A manager creates a template with items and it appears for crew to run
- [ ] Editing a template creates a new version; the old version stays attached to past runs
- [ ] Crew cannot create or edit a template — rules refuse the write even if the UI is bypassed

**Runs**
- [ ] Due/overdue/missed states are correct for opening, closing, and each periodic category
- [ ] Opening and closing produce exactly one run per business day
- [ ] Periodic categories produce one run per interval slot
- [ ] A run does not pre-fill previous answers
- [ ] A numeric item outside its bounds is flagged but does not block completion
- [ ] A missed run creates a `medium` exception, once, not on every subsequent view
- [ ] **Wifi off:** a run completes, queues, and lands on reconnect

**Exceptions**
- [ ] The inbox lists open/in-progress/escalated exceptions from every source, including M1's
- [ ] Resolving requires a corrective action and records who verified it
- [ ] An exception open across 3 business days is reassigned to `store_manager` and marked `escalated`

**Small logs**
- [ ] A queue escalation logs and can be resolved
- [ ] Discarding a quarantine lot writes a linked wastage record automatically
- [ ] A receiving record captures ordered vs received quantity and flags a discrepancy

**Audit**
- [ ] Every run, response, escalation, wastage and receiving write produces an `auditLog` entry
- [ ] No update or delete path exists on `checklistResponses`
- [ ] A correction is a new response referencing the same item, and the original stays visible
