# 14 — M9 · Employee self-service and leave

**Build this tenth and last.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one last

Every module before this one was written for whoever is standing at the shop-floor tablet. M9 is the first screen meant to be opened from an employee's own phone, off the floor, on their own time — checking hours, asking for leave, flagging a clock-in that looks wrong. It depends on almost everything already built (M3's time and certifications, M3's roster, the exception/correction patterns from M1-M2) and adds nothing the rest of the roadmap needs, which is exactly why it's last.

## The identity problem this spec exists to solve

`users/{id}.authUid` has existed since M0 (`docs/03-M0-FOUNDATION.md`) and `firestore.rules` has always had `request.auth.uid == resource.data.authUid` in the `users` read rule — anticipated, never used until now. A personal login is a **third kind of session** alongside the two `docs/01-ARCHITECTURE.md` already describes: a managed Firebase Auth account, like a manager's, but one that maps to a specific `users` document instead of acting as an administrator.

**This matters because of a real, narrow inconsistency already in the codebase.** `lib/write.ts`'s `resolveActor()` and `modules/time/actions.ts`'s `currentActor()` both fall back to `auth.user.uid` as `userId` for any managed account with no PIN active — correct for a manager clocking in on their own device (rare, but the fallback exists), and it's *also* what a personal login would produce if nothing changed: an employee's `leaveRequests`/`timeEntryDisputes` would carry `userId: <their Firebase UID>`, while everything they've ever done at the station carries `userId: <their users-collection doc id>` (the PIN-cache identity). Two identities for one person.

**The fix is scoped entirely to new M9 code, not a retroactive change to M0-M8.** Realistically, clock-in/out happens at the shared station (it requires a photo, a shared device) — an employee's `timeEntries` and `rosterAssignments` are always going to be PIN-attributed. Personal-login screens resolve **their own `users` doc id once**, via `usersCol where authUid == auth.user.uid` (already rules-legal, see above), and use that resolved id both to query their own existing records and to stamp on anything M9 itself writes. `lib/write.ts` and `modules/time/actions.ts` are untouched.

## What it does

1. Personal login — a managed account tied to a specific `users` doc via `authUid`
2. Own hours, roster, certifications, night-differential accrued — read-only, reusing M3's `lib/hours.ts` and certification logic as-is
3. Leave requests with a coverage check — computed at request time, showing the approver what the roster looks like if granted
4. Time-record disputes — the employee flags, never edits; the manager's correction is the same `correct()` path M3 already built
5. Leave entitlement — company leave from regularisation (`staff.probation_months`, already seeded at 6), statutory SIL from `staff.statutory_sil_eligibility_months` (already seeded at 12) — modeled as two separate, already-configurable entitlements, per the note already in `docs/05-PARAMETERS.md`

No new parameters. Everything M9 needs was seeded in M0.

## Granting personal access

There is no self-service sign-up — onboarding stays owner-controlled, same friction as the owner/station bootstrap in `RUNBOOK.md`. `setUserRole` (owner-only, `functions/src/index.ts`) gains one optional field:

```ts
type SetUserRoleRequest = { targetAuthUid: string; role: RoleCode; branchId: string | null; userId?: string }
```

When `userId` is supplied (the employee's existing `users`-collection doc id), the function also writes `authUid: targetAuthUid` onto that doc, in the same call — granting the claim and linking the identity together, since they're the same conceptual action ("this managed account *is* this person"). The owner still creates the Firebase Auth user by hand first (Console, or `firebase auth:import`), exactly as for the owner/station accounts.

## Data model additions

### `leaveRequests/{id}`
```ts
OperationalBase & {
  userId: string, userName: string,   // resolved via authUid, not actorId — see above
  type: 'company' | 'statutory_sil',
  startDate: string, endDate: string,   // YYYY-MM-DD
  reason: string,
  coverageSnapshot: Array<{
    shiftInstanceId: string, templateName: string, date: string,
    assignedCount: number, minRequired: number, wouldBeShort: boolean,
  }>,
  status: 'pending' | 'approved' | 'denied',
  decidedBy: string | null, decidedByName: string | null, decidedAt: Timestamp | null,
  decisionNote: string,
}
```
`coverageSnapshot` is computed **once, at submission** — for every shift instance in `[startDate, endDate]` the employee is currently rostered for, how many people are assigned and whether removing this one drops it below the shift template's `targetHeadcount.min`. Frozen, same reasoning as M6's handover pack: the approver sees what the roster looked like when the request was made, not a number that could have drifted by the time they open it.

### `timeEntryDisputes/{id}`
```ts
OperationalBase & {
  userId: string, userName: string,
  timeEntryId: string,
  reason: string,
  status: 'open' | 'resolved',
  resolvedBy: string | null, resolvedByName: string | null, resolvedAt: Timestamp | null,
  correctionEntryId: string | null,   // the new timeEntries doc the manager's correction produced
}
```
The employee cannot edit a `timeEntries` document — nothing in this system ever lets anyone do that, append-only since M3. A dispute is a flag pointing at one; resolving it means the manager calls the **existing** `correct('timeEntries', originalId, data, reason)` path (`lib/write.ts`, already built and tested in M3) and records the new entry's id back on the dispute.

## Screens

### 1 · My self-service
Reachable once a personal login resolves a linked `users` doc. Own hours (reuses `summarizeShifts` from `lib/hours.ts`, same computation `MyShiftPage` already uses), upcoming roster, certifications (with expiry shown plainly, same as the certification register), and leave entitlement status: "eligible for company leave since {hiredAt + probation_months}" / "not yet eligible" and the same shape for statutory SIL.

### 2 · Request leave
Type, date range, reason. Submitting computes and freezes the coverage snapshot, then writes the request as `pending`. Eligibility is shown as a warning if the request predates the employee's eligibility date — **not blocked**, since a close-to-the-boundary request is exactly the kind of judgment call a manager should see and decide, not have silently refused by the client.

### 3 · My requests / My disputes
Own leave requests and time-entry disputes, status visible, newest first.

### 4 · Leave approvals (manager)
Pending requests branch-wide, the frozen coverage snapshot shown plainly (including which shifts would go short), approve/deny with a required note on denial.

### 5 · Dispute inbox (manager)
Open disputes, linking to the disputed `timeEntries` doc. Resolving opens the existing correction flow and marks the dispute `resolved` with `correctionEntryId` set.

## Security rules — the shape

```
match /leaveRequests/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if isManager() && sameBranch(resource.data.branchId);
  allow delete: if false;
}

match /timeEntryDisputes/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if isManager() && sameBranch(resource.data.branchId);
  allow delete: if false;
}
```
No rules changes needed on `users`, `timeEntries` or `rosterAssignments` — the `authUid` read clause has existed since M0, and both other collections are already branch-wide readable to any signed-in user (the security boundary has always been the managed account, not row-level ownership).

## Acceptance criteria

**Personal login**
- [ ] `setUserRole` with a `userId` writes `authUid` onto that `users` doc in the same call
- [ ] A personal login can read its own `users` doc via the existing `authUid` rule clause
- [ ] `lib/write.ts` and `modules/time/actions.ts` are unchanged — the identity fix is scoped to new M9 code only

**Own data**
- [ ] Own hours matches exactly what `MyShiftPage` would show the same person via station+PIN — same `lib/hours.ts` functions, same input records
- [ ] Certifications show expiry plainly, expired never counted as active

**Leave requests**
- [ ] The coverage snapshot is computed once, at submission, and never recomputed on read
- [ ] A request before the employee's eligibility date is shown as a warning, not blocked
- [ ] Only a manager can approve or deny

**Disputes**
- [ ] An employee can flag a `timeEntries` doc but never edit or delete it
- [ ] Resolving a dispute produces a new `timeEntries` doc via the existing `correct()` path, never an edit of the original
- [ ] The dispute records which correction resolved it

**Audit**
- [ ] Every leave request, dispute, and `setUserRole` call with a `userId` produces an `auditLog` entry
- [ ] No delete path exists on either new collection
