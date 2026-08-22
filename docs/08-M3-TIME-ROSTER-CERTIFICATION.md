# 08 — M3 · Time, roster and certification

**Build this fourth.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M0-M2 gave the store instruments for equipment and routine. M3 gives it people: who's actually here versus who was supposed to be, what they're allowed to do, and the one control that turns "roster" from a spreadsheet into an enforcement mechanism — the shift can't go live short of who the law and the manual require on the floor.

**M3 must work with M0-M2 present, not couple further forward.** No cash, no handover, no self-service login.

## What it does

1. Clock in / out on the station device, with photo
2. Breaks
3. Actual versus rostered, with night-differential computed separately
4. Roster builder with a coverage view against target headcount
5. Certification register (L1–L5, plus Module F food certification)
6. **The control that matters:** the roster refuses to assign an uncertified person to the till, and enforces three cover tests before a shift can be considered covered
7. Verified hours export

## Data model additions

### `timeEntries/{id}`
```ts
OperationalBase & {
  userId: string, userName: string,
  type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  at: Timestamp,
  photoRef: string | null,   // required for clock_in/clock_out, not for breaks
  method: 'station' | 'correction',
}
```
Append-only, exactly like `temperatureReadings` — a correction is a new entry with `correctsId`, never an edit of the clock event itself. `photoRef` follows the same pre-generated-id pattern as M1/M2 photos.

### `rosterAssignments/{id}`
```ts
OperationalBase & {
  shiftInstanceId: string, businessDayId: string,
  userId: string, userName: string,
  role: RoleCode,
  status: 'planned' | 'confirmed' | 'cancelled',
}
```
A living record like `excursions` and `checklistRuns` — created once (through `writeOperational`, so it gets the five stamps and an audit entry), then updated directly for status changes. Cancelling is a status change, not a delete — the roster history for a shift stays reconstructable.

### `User.certifications` — no shape change
Already defined in `docs/02-DATA-MODEL.md` (M0): `certifications: { [level: string]: { certifiedAt, expiresAt, assessorId } }`. M3 is the first module to actually read and write it. Levels used: `'L1'` through `'L5'`, and `'module_f'` for food certification. A certification with `expiresAt` in the past counts as not held — expired is not certified.

### Hours — computed, not stored
Actual-vs-rostered and night-differential hours are derived at view time from `timeEntries` + the `shiftInstance`'s planned times + the seeded `staff.night_diff_start` / `staff.night_diff_end` / `staff.night_diff_rate_pct` parameters, the same way M1 computes slot status from equipment + parameters rather than storing it. No new collection for this — a stored "computed hours" record would be a second source of truth that drifts from the raw clock events it's derived from.

## Screens

### 1 · Clock in / out
One tap from home, same urgency as M1's readings screen. Shows the current actor's status (clocked in / on break / clocked out) and the single relevant action button. Clock in and clock out require a photo; breaks don't (they happen mid-shift, often away from the tablet). **No pre-filling** — same reasoning as every other capture screen in this system.

### 2 · My shift (actual vs rostered)
For the currently clocked-in (or most recent) shift: planned start/end from the `shiftInstance`, actual start/end from `timeEntries`, break time deducted, variance shown plainly. Night-differential minutes broken out separately, not folded into the total.

### 3 · Roster builder (manager)
Grid: shift instances for a business day (or week) down one axis, assigned staff across. Add/remove an assignment. **Assigning a role checks certification before the write succeeds** — attempting to assign someone without the required level for that role is refused with a plain explanation, not a silent failure.

### 4 · Coverage view (manager)
Per shift instance: assigned count against `shiftTemplate.targetHeadcount`, and the three cover tests as pass/fail:
- An L4-or-above certified person is assigned
- The person assigned as `cashier` is L3-or-above certified
- Someone Module-F certified is assigned (G7 sells prepared food from a ramyeon station and kitchen every trading hour it's open — this test always applies, there's no "food not being sold today" state)

A shift failing any test is flagged, not blocked — the roster is a planning tool; the till-assignment check in the builder is the one hard stop, because that's the moment an uncertified person would otherwise start ringing sales.

### 5 · Certification register (manager)
Per user: current certifications with level, certified date, expiry, assessor. Add a new certification (records who assessed it — a manager attests, doesn't self-certify). Expired certifications show plainly as expired, not silently dropped.

### 6 · Verified hours export (manager)
Date range, per-user table: regular hours, night-differential hours, break time, variance against rostered. Downloadable as CSV. This produces **verified hours**, not payroll — SSS/PhilHealth/Pag-IBIG/13th-month/OT computation stays out of scope per `docs/00-BRIEF.md`.

## Logic

**Clock in/out photo.** Same compress-then-queue pattern as M1/M2: pre-generate the `timeEntries` doc id, compute the Storage path from it, queue the upload in the background, write the entry with `photoRef` already pointing at where the file will land.

**Certification check at assignment.** `role -> minimum level` is fixed by the manual, not configurable per branch:
- `cashier` requires `L3` or above
- `shift_leader` requires `L4` or above
- Any role touching food prep (`kitchen_staff`) requires `module_f`
A level is "or above" in the L1–L5 ladder — holding L4 satisfies an L3 requirement. `module_f` is its own axis, not part of the ladder — holding L5 does not imply Module F.

**Night-differential.** For each clock_in/clock_out pair, split the worked interval at `staff.night_diff_start` (22:00) and `staff.night_diff_end` (06:00) boundaries; minutes falling inside that window are night-differential, computed and shown separately, never blended into a single "hours worked" figure — docs/06-ROADMAP.md is explicit this must be separated "from day one."

**Rest days.** Not a separate record. A business day with no `rosterAssignment` for a user is that user's rest day for planning purposes — this is what "the roster's own data already answers the question" looks like; a dedicated collection would just be a second place the same fact could go stale.

**Breaks and actual-vs-rostered.** Total worked time = (last clock_out − first clock_in) − sum(break_end − break_start) for that shift instance. Multiple clock in/out pairs in one business day are treated as separate shift attendances, matched to the nearest `shiftInstance` by time overlap.

## Security rules — the shape

```
match /timeEntries/{id} {
  allow read:            if signedIn() && sameBranch(resource.data.branchId);
  allow create:          if signedIn() && sameBranch(request.resource.data.branchId)
                           && request.resource.data.actorId is string
                           && request.resource.data.createdAt == request.time;
  allow update, delete:  if false;   // append-only, corrections are new entries
}

match /rosterAssignments/{id} {
  allow read:   if signedIn() && (resource == null || sameBranch(resource.data.branchId));
  allow create: if isManager() && sameBranch(request.resource.data.branchId);
  allow update: if isManager() && sameBranch(resource.data.branchId);
  allow delete: if false;
}
```
`users` write rules are unchanged from M0 (`isManager()` only) — certification edits go through the existing path, no new rule needed.

## Acceptance criteria

**Clock in/out**
- [ ] Clock in requires a photo and records the actor, time and station device
- [ ] Clock out requires a photo
- [ ] A break can be started and ended without a photo
- [ ] **Wifi off:** clock in/out queues and lands on reconnect, same as every other capture screen

**Actual vs rostered**
- [ ] Planned and actual times both show, with variance
- [ ] Break time is deducted from the worked total
- [ ] Night-differential minutes (22:00–06:00) are computed and shown separately, never merged into the total

**Roster**
- [ ] A manager can assign a user to a shift instance and role
- [ ] Assigning an uncertified user to `cashier` is refused, with a plain explanation, before the write happens
- [ ] The coverage view shows assigned count against target headcount
- [ ] All three cover tests (L4 present, L3 on the drawer, Module F present) show pass/fail per shift
- [ ] Cancelling an assignment changes its status; the record is never deleted

**Certification**
- [ ] A manager can record a new certification with level, date and assessor
- [ ] An expired certification displays as expired and does not satisfy a coverage test or an assignment check
- [ ] A non-manager cannot edit certifications — the existing `users` write rule already refuses it

**Export**
- [ ] The hours export covers a chosen date range, per user, with regular and night-differential hours split
- [ ] Downloads as CSV

**Audit**
- [ ] Every time entry and roster assignment write produces an `auditLog` entry
- [ ] No update or delete path exists on `timeEntries`
- [ ] A correction is a new time entry referencing the original, which stays visible
