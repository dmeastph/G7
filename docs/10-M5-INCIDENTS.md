# 10 — M5 · Incidents

**Build this sixth.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M1-M4 gave the store instruments for the things that go wrong on a schedule — temperature, routine, cash. An incident doesn't happen on a schedule. It needs to be captured fast, in whatever state the reporter is in, and it needs to survive scrutiny later — a police report, an insurance claim, a parent asking what happened to their kid at the counter. The record has to be good enough for that on the first write, because there's rarely a second chance to get the narrative right.

**M5 must work with M0-M4 present, not couple further forward.** No shift handover pack, no document control.

## The hard boundary this spec is built around

**This system never touches CCTV footage** (`docs/00-BRIEF.md` — an explicit non-goal). It records *that* a clip was preserved, by whom, until when — camera, time range, and a reference to wherever the actual footage lives (a DVR export path, a filename, whatever the branch's own video system uses). **Do not build anything that uploads, plays, or stores video.** The `clipRef` field is a string a human types, not a link this system resolves.

## What it does

1. Typed incident capture — type, severity, narrative, immediate action taken
2. CCTV preservation register — cameras, time range, clip reference, retain-until date, one entry per preservation action
3. Escalation — any signed-in user can escalate; escalating raises the linked exception to critical
4. Closure — requires a root cause, same "can't close without the real answer" pattern as M1's maintenance tickets

## Data model additions

### `incidentRecords/{id}`
```ts
OperationalBase & {
  type: 'theft' | 'injury' | 'altercation' | 'property_damage' | 'safety' | 'security' | 'other',
  severity: 'low' | 'medium' | 'high' | 'critical',
  occurredAt: Timestamp,       // editable — an incident is often reported after the fact
  narrative: string,
  immediateAction: string,
  status: 'open' | 'escalated' | 'closed',
  exceptionId: string | null,  // the linked exception, raised automatically on report
  rootCause: string,           // required at closure, empty until then
  closedBy: string | null, closedAt: Timestamp | null,
}
```
`actorId`/`actorName` (from `OperationalBase`) already carry who reported it — no separate `reportedBy` field duplicating that.

### `cctvPreservations/{id}`
```ts
OperationalBase & {
  incidentId: string,
  cameras: string[],           // free-text labels — no camera equipment register exists to key against
  rangeStart: Timestamp, rangeEnd: Timestamp,
  clipRef: string,              // where the export lives — never a link this system opens
  retainUntil: Timestamp,
}
```
Append-only, one document per preservation action. An incident with footage from three cameras exported at different times is three documents, not one with an array of clip refs — each preservation action has its own person, its own timestamp, its own chain of custody, same reasoning as `cashDrops`.

**No default retention period is seeded.** `docs/05-PARAMETERS.md` has no `cctv.*` key, which means the branch hasn't told us one — `retainUntil` is typed by the person preserving the clip, every time, never computed from a fabricated default.

## Screens

### 1 · Report incident
Type, severity, narrative, immediate action taken. `occurredAt` defaults to now but is editable, since incidents are often reported minutes or hours after the fact. Submitting creates the incident **and** a linked exception in the same shape M1 uses for excursions — `source: 'incident'`, `severity` mirrored from the incident, `ownerRole: 'shift_leader'` — so an incident is visible in the Exceptions Inbox from the moment it's typed, not after some later escalation step.

### 2 · Incident detail
Narrative, immediate action, status. Three sections:
- **CCTV preservation** — list of preservation entries; "Preserve a clip" opens a form for cameras (comma-separated), time range, clip reference, retain-until date.
- **Escalate** — any signed-in same-branch user; bumps `status` to `escalated` and the linked exception to `severity: critical, status: escalated` — the same shape as M1's `escalateToQuarantine`.
- **Close** — requires `rootCause`; enforced in the UI and in Firestore rules, same pattern as M1's `verifiedWorkingBy` gate on maintenance tickets.

### 3 · Incidents list
Open and escalated incidents for the branch, newest first, type + severity + a link into the detail screen. Closed incidents remain readable (append-only, nothing here is ever hidden) but the list defaults to what's still open.

## Security rules — the shape

```
match /incidentRecords/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if signedIn() && sameBranch(resource.data.branchId)
                 && (request.resource.data.status != 'closed'
                     || (request.resource.data.rootCause is string && request.resource.data.rootCause.size() > 0));
  allow delete: if false;
}

match /cctvPreservations/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update, delete: if false;
}
```
No role gate beyond "signed in, same branch" on either collection — an incident is exactly the kind of thing the person standing there needs to be able to record and act on immediately, the same reasoning M1 uses for excursions. The closure gate is the real guard, not a role.

## Acceptance criteria

**Report**
- [ ] Creating an incident stamps the five `OperationalBase` fields and creates an `auditLog` entry
- [ ] Creating an incident also creates a linked exception with `source: 'incident'` and matching severity
- [ ] `occurredAt` can be set to a time before `createdAt`

**CCTV preservation**
- [ ] A preservation entry records cameras, time range, clip reference and retain-until date
- [ ] No video is uploaded, played, or stored anywhere in this flow
- [ ] A preservation entry cannot be edited or deleted once created — rules refuse it even if the UI is bypassed
- [ ] Multiple preservation entries can exist for one incident

**Escalation**
- [ ] Escalating sets the incident to `escalated` and the linked exception to `critical`/`escalated`
- [ ] Any signed-in same-branch user can escalate — no role gate blocks it

**Closure**
- [ ] Closing without a root cause is refused, in the UI and in rules
- [ ] Closing with a root cause sets `status: closed`, `closedBy`, `closedAt`

**Audit**
- [ ] Every incident and preservation write produces an `auditLog` entry
- [ ] No delete path exists on either collection
- [ ] An incident is never edited to remove or rewrite its original narrative — corrections, if ever needed, are a new exception/note, not a rewritten record
