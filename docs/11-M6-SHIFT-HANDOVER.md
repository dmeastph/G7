# 11 — M6 · Shift handover

**Build this seventh.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M1-M5 gave the store instruments for cold chain, routine, cash and incidents. None of them answer the one question a shift leader arriving at 14:00 actually has: *what do I need to know right now that the last six hours produced?* Paper form G7-F-03 answers that today by making the outgoing leader write it down and the incoming leader sign for it. M6 is that same exchange, except the pack is assembled from data that already exists rather than recalled from memory at the worst possible time — the end of a shift.

**M6 must work with M0-M5 present, not couple further forward.** No document control, no dashboard.

## What it does

1. A handover pack, generated on demand from the outgoing shift's own data — not a form someone fills in blank
2. Explicit acceptance by the incoming leader, with an optional note
3. Carry-forward escalation across shifts — an item still open after three consecutive handovers gets bumped to critical

## Why this carry-forward is not M2's carry-forward

`exceptions` already has a carry-forward mechanism (`docs/07-M2-CHECKLISTS.md`, `lib/exceptions/reconcile.ts`): `carriedForwardCount` increments once per distinct **business day** an exception survives, escalating at 3. That field and that logic are untouched here — M6 does not repurpose it, and no other module's exception-creation call sites need to change.

The roadmap's "three shifts" is a different, shorter cadence — once the branch runs multiple shifts a day, three shifts can be under two days, materially faster than M2's three-*day* threshold. Rather than overload one field with two meanings, M6 computes its own carry-forward by looking at its own history: whether an exception appears in the open list of the **two immediately preceding** handover packs for this branch. Appearing in this pack plus the two before it is three consecutive shifts — no new field on `exceptions`, no touching M1/M2/M4/M5's write paths at all. This is computed at generation time, read-only against `shiftHandovers`.

## Data model additions

### `shiftHandovers/{id}`
```ts
OperationalBase & {
  shiftInstanceId: string,
  pack: {
    generatedAt: Timestamp,
    openExceptions: Array<{
      exceptionId: string, title: string,
      severity: 'low' | 'medium' | 'high' | 'critical', source: string,
      carriedShiftCount: number,   // 1..3+, computed at generation — see above
    }>,
    openIncidentCount: number,
    openTicketCount: number,
    cashSessionsStillOpen: number,   // sessions for this branch with status: 'open' at generation time
    checklistsCompletedToday: number,
    checklistsMissedToday: number,
  },
  status: 'pending' | 'accepted',
  acceptedBy: string | null, acceptedByName: string | null, acceptedAt: Timestamp | null,
  incomingNote: string,
}
```
`pack` is a **frozen snapshot** — read once at generation time from `exceptions`, `incidentRecords`, `maintenanceTickets`, `cashSessions`, `checklistRuns`, written into this one document, never recomputed live on the handover screen. The incoming leader is reviewing what the outgoing leader actually saw, not a number that drifted while they were reading it.

## Logic

### Generating a pack
Any signed-in same-branch user can generate one, for `useCurrentShift()`'s shift instance — in practice the outgoing leader, near the end of their shift. If a `shiftHandovers` document already exists for that `shiftInstanceId`, generating again returns the existing one rather than creating a duplicate (same "reuse, don't duplicate" rule M4 uses for cash sessions).

Building the snapshot:
- **Open exceptions** — every `exceptions` doc for the branch with `status in ['open', 'in_progress', 'escalated']`. For each, `carriedShiftCount` is computed by walking back through the two most recent **prior** `shiftHandovers` for this branch (ordered by `createdAt` descending, excluding the one being generated) and counting how many of them also listed this `exceptionId` as open, plus 1 for the current pack.
- **Escalation** — any exception whose computed `carriedShiftCount` reaches 3 gets `severity: 'critical', status: 'escalated'` written back to it, same shape as every other escalation path in this system (M1's `escalateToQuarantine`, M5's `escalate`). This is the "automatic escalation after three shifts" bullet — a side effect of generating the pack, not a separate scheduled job.
- **Everything else** — plain counts: open incidents, open maintenance tickets, cash sessions still open (a session left open into the next shift is exactly the kind of thing a handover exists to catch), checklists completed vs. missed for today's business day so far.

### Accepting a handover
The incoming leader reviews the pack, optionally types a note, and accepts. Acceptance sets `status: 'accepted'`, `acceptedBy`, `acceptedByName`, `acceptedAt`. Nothing about the frozen `pack` changes on accept — acceptance is acknowledgement, not a second data pull.

## Screens

### 1 · Handover list
Pending and recently-accepted handovers for the branch, newest first. A "Generate handover" button creates (or reuses) one for the current shift instance.

### 2 · Handover detail / accept
The frozen pack: open exceptions (with a visible flag on anything at `carriedShiftCount >= 3` — it was just escalated), incident/ticket counts, cash sessions still open, checklist completion. If `status === 'pending'`: a note field and an "Accept" button. If already `accepted`: who accepted it, when, and their note, read-only.

## Security rules — the shape

```
match /shiftHandovers/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if signedIn() && sameBranch(resource.data.branchId);
  allow delete: if false;
}
```
No role gate beyond signed-in/same-branch, same reasoning as excursions and incidents — whoever is physically present generating or accepting a handover is exactly who needs to be able to.

## Acceptance criteria

**Generation**
- [ ] Generating a handover snapshots open exceptions, incidents, tickets, cash sessions and checklist completion at that moment
- [ ] Generating again for the same shift instance returns the existing handover, not a duplicate
- [ ] The snapshot never recomputes live after generation — the detail screen reads the stored `pack`, not a fresh query

**Carry-forward**
- [ ] An exception open across this pack and the two immediately preceding handovers is marked `carriedShiftCount: 3` in this pack
- [ ] Reaching `carriedShiftCount >= 3` sets that exception's own `severity: critical, status: escalated`
- [ ] This never writes to or reads `carriedForwardCount`/`lastCarriedForwardBusinessDayId` — M2's day-based carry-forward is untouched

**Acceptance**
- [ ] Accepting requires no field beyond the action itself — the note is optional
- [ ] Accepting stamps who and when, and the pack itself does not change

**Audit**
- [ ] Every handover create and accept produces an `auditLog` entry
- [ ] No delete path exists on `shiftHandovers`
