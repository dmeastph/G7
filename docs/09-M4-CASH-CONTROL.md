# 09 — M4 · Cash control

**Build this fifth.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M0-M3 gave the store instruments, routine and people. M4 gives it the drawer — the one place a genuine dispute needs a genuine record, and the one module where a badly-designed control teaches people to cheat it rather than follow it.

**M4 must work with M0-M3 present, not couple further forward.** No incident register, no handover pack.

## The honest constraint this spec is built around

**This system has no POS integration** (`docs/00-BRIEF.md` — a third-party POS runs the store; this system never rings a sale). That means it cannot *compute* what a drawer should contain from sales data — there is no sales data here to compute it from. Every "expected" figure in this module is a number a person enters, sourced from the POS's own end-of-shift report, not a number this system derives. **Do not build a feature that pretends otherwise** — a fabricated "expected cash" figure is the cash-control equivalent of the food-safety numbers this project already refuses to invent.

## What it does

1. Cash sessions — a drawer bound to one named person, with an opening float
2. Safe drops — bag number, chain of custody, manager receipt confirmation
3. Blind close count — the physical count is entered before anyone sees the expected figure
4. Variance — computed once the expected figure is revealed, flagged past the investigation threshold
5. The void/refund/override/no-sale log — this system doesn't perform these (no POS), it records that they happened, for audit

## Data model additions

### `cashSessions/{id}`
```ts
OperationalBase & {
  userId: string, userName: string,      // the one named person the drawer is bound to
  openedAt: Timestamp, openingFloatCentavos: number,
  status: 'open' | 'closed',
  closedAt: Timestamp | null,
}
```
One open session per person per drawer at a time — enforced in the UI (the open-session screen shows and reuses an existing open session rather than letting a second one start). `userId` is the PIN-cache id or managed-account uid, same identity model as every other module; Firestore rules cannot verify "is this the same person re-opening" any more precisely than M0's architecture doc already says they can (station auth is a shared identity, the PIN is attribution not authorisation) — closing is gated to `signedIn() && sameBranch(...)`, the same "any signed-in same-branch user" shape as M1's excursions and M3's roster-progress fields.

### `cashDrops/{id}`
```ts
OperationalBase & {
  sessionId: string,
  amountCentavos: number, bagNumber: string,
  status: 'dropped' | 'received',
  receivedBy: string | null, receivedAt: Timestamp | null,
}
```
`bagNumber` plus `receivedBy`/`receivedAt` **is** the chain of custody — a drop that's never confirmed received stays visibly `dropped`, not silently assumed fine.

### `cashCloseCounts/{id}`
```ts
OperationalBase & {
  sessionId: string,
  countedCentavos: number, countedAt: Timestamp, countedBy: string,   // the blind count
  expectedCentavos: number | null,                                    // null until revealed
  revealedBy: string | null, revealedAt: Timestamp | null,
  varianceCentavos: number | null,                                    // countedCentavos - expectedCentavos, set on reveal
  requiresInvestigation: boolean,
  investigationNote: string,
  status: 'counted' | 'revealed',
}
```
**The blind count is the whole point of this record shape.** `countedCentavos` is written and the document exists *before* `expectedCentavos` is ever entered — there is no code path that shows the counter an expected figure first. Revealing is a separate write, by a different action, typically by whoever is transcribing the POS end-of-shift report.

### `cashRegisterExceptions/{id}`
```ts
OperationalBase & {
  sessionId: string,
  type: 'void' | 'refund' | 'override' | 'no_sale',
  amountCentavos: number | null, reason: string,
  approvalRequired: boolean,        // amountCentavos > cash.shift_leader_approval_limit
  approvedBy: string | null, approvedAt: Timestamp | null,
}
```
This is a **log**, not an enforcement point — the void/refund/override actually happens on the POS, which this system doesn't touch. What's recorded here is that it happened, why, and who signed off, for the same reason the manual requires a paper twin for it: a pattern of unexplained voids is a theft signal only if someone can see the pattern.

## Screens

### 1 · Cash session
Open: enter opening float (shown against the seeded `cash.opening_float` for reference, not enforced — floats legitimately vary), bind to the current actor. If an open session already exists for this actor, show it instead of opening a second one.

### 2 · Cash drop
Log a drop: amount, bag number. Shows `cash.drawer_alert_threshold` and `cash.drawer_max_after_2200` (switching to the lower after-22:00 cap automatically, using the already-seeded night-differential-style time boundary) as **reference figures**, not a computed live balance — this system doesn't know the live balance (see the honest constraint above) and must never show a number that looks computed but isn't. A reminder tile (same due/overdue mechanism as M1 temperature readings and M2 checklists, reusing `lib/slots.ts`) prompts a drop check every `cash.drop_interval_minutes`; skipping it doesn't block anything, it raises a `low`-severity exception, because a missed drop reminder is a prompt, not an incident.

### 3 · Confirm drop receipt (manager)
List of `dropped`-status drops; confirming sets `received`, `receivedBy`, `receivedAt`. Manager-only — `docs/06-ROADMAP.md` says "manager receipt confirmation" explicitly.

This list is **branch-wide, not scoped to the manager's own session** — a manager typically doesn't run a personal drawer either, they confirm receipt of other cashiers' drops. A "pending drop receipts" list surfaces every `dropped`-status drop in the branch to any manager, independent of whose session it belongs to.

### 4 · Close count (blind)
One field: counted total. Submitting writes the `cashCloseCounts` document with `expectedCentavos: null`. **The screen must not display, fetch, or precompute an expected figure at any point before submission** — this is the one UI behaviour in this whole spec that's a correctness requirement, not a preference.

### 5 · Reveal and variance (shift leader or above)
For a `counted` close count: enter the expected figure from the POS report. Submitting computes and stores the variance, sets `requiresInvestigation` when `abs(variance) >= cash.variance_investigation_threshold`. A variance requiring investigation needs a note before the screen lets the session close. A variance whose absolute value exceeds `cash.shift_leader_approval_limit` needs a store_manager/owner to be the one who reveals it — checked client-side (the same pattern M3 uses for certification-at-assignment; Firestore rules can't practically evaluate a live parameter value at write time without adding real security-rule complexity for a check that isn't a hard security boundary here).

This list is **branch-wide, not scoped to the revealer's own session** — a shift leader typically doesn't run a personal drawer at all, they review other cashiers' closed-out counts. A "pending reveals" list surfaces every `counted` close count in the branch to any shift leader or above, independent of whose session it belongs to.

**The investigation note is written in the same place, by the same person, not on the cashier's own session screen.** Writing to `cashCloseCounts` is a supervisor-only action at the rules level (`isSupervisor()`) — the same boundary that gates the reveal itself — so a cashier's station+PIN session can never save the note even though the field would otherwise show on their screen. The pending-reveals list carries a count through both steps it might owe a supervisor: reveal it, then (if `requiresInvestigation`) add the note, before it drops off the list. The cashier's own "Close count" view only ever displays the note once it exists — read-only, never an editable field they can't actually persist.

### 6 · Void / refund / override / no-sale log
Type, amount (optional — a no-sale has none), reason. `approvalRequired` is set automatically when the amount exceeds the shift leader limit; an unapproved required entry shows plainly as unapproved, not hidden.

## Security rules — the shape

```
match /cashSessions/{id} {
  allow read:   if signedIn() && (resource == null || sameBranch(resource.data.branchId));
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* actorId, createdAt stamps */;
  allow update: if signedIn() && sameBranch(resource.data.branchId);   // closing — see "one named person" note above
  allow delete: if false;
}

match /cashDrops/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if (isStation() || isManager()) && sameBranch(request.resource.data.branchId) && /* stamps */;
  allow update: if isManager() && sameBranch(resource.data.branchId);   // receipt confirmation only
  allow delete: if false;
}

match /cashCloseCounts/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn() && sameBranch(request.resource.data.branchId) && /* stamps */;
  allow update: if (isManager() || hasRole('shift_leader')) && sameBranch(resource.data.branchId);
  allow delete: if false;
}

match /cashRegisterExceptions/{id} {
  allow read:   if signedIn() && sameBranch(resource.data.branchId);
  allow create: if (isStation() || isManager()) && sameBranch(request.resource.data.branchId) && /* stamps */;
  allow update: if (isManager() || hasRole('shift_leader')) && sameBranch(resource.data.branchId);   // approval
  allow delete: if false;
}
```

## Acceptance criteria

**Sessions**
- [ ] Opening a session binds it to the current actor and records the opening float
- [ ] Reopening while a session is already open for that actor shows the existing one, not a second

**Drops**
- [ ] A drop records amount and bag number
- [ ] A missed drop-interval reminder raises a `low` exception, once, not on every view
- [ ] A manager can confirm receipt; a non-manager cannot — rules refuse it even if the UI is bypassed
- [ ] An unconfirmed drop stays visibly `dropped`

**Close count**
- [ ] The close-count screen never displays or fetches an expected figure before the count is submitted
- [ ] Submitting a count creates a document with `expectedCentavos: null`
- [ ] Revealing the expected figure is a separate action by a different screen
- [ ] Variance is computed only on reveal, never before
- [ ] A variance at or past `cash.variance_investigation_threshold` requires a note before the session can close
- [ ] A variance exceeding `cash.shift_leader_approval_limit` can only be revealed by a store_manager or owner

**Exception log**
- [ ] A void/refund/override/no-sale entry records type, reason and (where applicable) amount
- [ ] An entry whose amount exceeds the shift leader limit is marked `approvalRequired` automatically
- [ ] An unapproved required entry displays plainly as unapproved

**Audit**
- [ ] Every session, drop, count and exception-log write produces an `auditLog` entry
- [ ] No delete path exists on any M4 collection
- [ ] Corrections are new documents, never edits of the original figures
