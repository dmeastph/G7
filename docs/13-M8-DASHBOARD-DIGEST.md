# 13 — M8 · Dashboard and daily digest

**Build this ninth.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule. The roadmap itself calls this "Highest value per hour of build time in the project" — it's the one screen that answers "is anything wrong right now" without opening eight other screens first.

## Why this one next

M0-M7 gave the store instruments, each answering its own narrow question. Nobody has asked the store's actual question yet: *right now, across everything, what needs attention?* That's the live dashboard. And at close, a second question: *how did today go, and what's still open?* That's the digest — the one artifact in this whole system meant to be read without opening the app at all.

**M8 must work with M0-M7 present, not couple further forward.** No employee self-service.

## Two different problems, two different data paths

**The live view reads current state directly.** "Open exceptions," "cash sessions still open," "checklists missed today" are small, cheap, already-indexed queries — the exact same shape M4-M6 already run live throughout the day (M6's handover pack does this same rollup at every shift boundary). This is not the "aggregate raw records" problem `docs/01-ARCHITECTURE.md` warns about; that warning is about summing across a full day's or week's worth of history, not counting what's currently open.

**The digest is the historical snapshot that warning is actually about.** "How many readings were taken today, across how many units, over 18 hours" is real aggregation over potentially hundreds of raw records — exactly what `dailySummaries` (`docs/02-DATA-MODEL.md`, specified since M1, never yet built) exists to avoid recomputing on every dashboard load. M8 is where it finally gets built: written once, server-side, at business-day close.

## What it does

1. Live dashboard — open exceptions, missed checks, cash position, temperature status, staffing gaps, certifications expiring
2. Close business day — a manager action, server-side, that computes and writes the day's `dailySummaries` rollup
3. Daily digest — the day's numbers and anything unresolved, written to `dailySummaries` and queued for delivery to the owner
4. Digest history — past digests stay readable in-app, regardless of whether external delivery is configured

## Why the digest's delivery is a seam, not a vendor

"One message to the owner" implies something delivered outside the app — email, SMS, whatever. Nothing in this project has ever chosen an email/SMS provider, and there is no API key for one anywhere in the repo. Picking one now would mean inventing a vendor relationship and credentials nobody asked for — the same class of mistake as inventing a food-safety number. Instead, `closeBusinessDay` writes the digest content to a `mail/{id}` document in the shape Firebase's own **Trigger Email** extension expects (`{ to, message: { subject, text } }`) — installing and configuring that extension (or pointing it at real SMTP) is a deployment-time decision for the owner, documented in `RUNBOOK.md`, not a code decision for this session. **The in-app digest history is never dependent on that extension being installed** — it's the fallback, same role paper always plays elsewhere in this system.

## Data model additions

### `dailySummaries/{id}` — id `{branchId}_{YYYY-MM-DD}`
Extends the shape `docs/02-DATA-MODEL.md` specified in M1, adding the two sections that didn't exist yet when that shape was written (cash didn't exist until M4, certifications until M3):
```ts
{
  branchId: string, businessDate: string, computedAt: Timestamp,
  temperature: { readingsDue: number, readingsTaken: number, missed: number, excursionsOpened: number, excursionsOpen: number },
  quarantine: { lotsOpen: number, estValueCentavos: number },
  maintenance: { ticketsOpen: number, ticketsOpened: number, ticketsClosed: number },
  exceptions: { opened: number, closed: number, openTotal: number, overdue: number },
  staffing: { shiftsPlanned: number, shiftsShort: number },
  cash: { sessionsOpenAtClose: number, totalVarianceCentavos: number, unresolvedInvestigations: number },
  certifications: { expiringCount: number },
}
```
Written once, by `closeBusinessDay`, never recomputed client-side. `cash.totalVarianceCentavos` sums every `cashCloseCounts.varianceCentavos` revealed today — a signed number, so a shortage and an overage on different tills don't quietly cancel out on the dashboard the way they would summed elsewhere; showing the sum here is a deliberate, coarse "how did cash go today" figure, not a substitute for reading the exceptions list.

## Logic

### Live dashboard
Reads directly, no new collection:
- **Open exceptions** — `exceptions` where `status in ['open','in_progress','escalated']`, same query shape as M6.
- **Missed checks today** — `checklistRuns` where `businessDayId == today` and `status == 'missed'`.
- **Cash position** — `cashSessions` where `status == 'open'` (count); `cashCloseCounts` where `status == 'counted'` (pending reveal) or `revealed && requiresInvestigation && !investigationNote` (pending investigation note) — the same two states M6's "pending reveals" list already surfaces.
- **Temperature status** — equipment currently outside range: `excursions` where `status == 'open'`.
- **Staffing gaps** — today's `rosterAssignments` vs. each active shift template's `targetHeadcount.min`.
- **Certifications expiring** — only computed when `staff.certification_expiry_warning_days` is set; otherwise the tile reads "not set," same rule as every unset parameter in this system. When set, counts active users with a certification whose `expiresAt` falls within that many days of now.

### Close business day (manager, server-side)
A callable Cloud Function, `closeBusinessDay({ branchId, businessDayId })` — manager-only (same `requireCallerRole` guard `setUserRole`/`resetUserPin` already use). Runs with Admin SDK privileges specifically because this is real aggregation across a full day's raw records, the case `docs/01-ARCHITECTURE.md` reserves for server-side rollups rather than a client doing it with rules-restricted reads:
1. Reads every collection needed for the `dailySummaries` fields above, scoped to `businessDayId`.
2. Writes `dailySummaries/{branchId}_{businessDate}`.
3. Sets `businessDays/{businessDayId}.status = 'closed'`, `closedBy`, `closedAt`.
4. Looks up the owner's email (the managed account whose custom claim `role == 'owner'`) and writes a `mail/{id}` document with the digest as subject/body text — best-effort; a missing or unconfigured mail extension does not fail the close.
5. Writes an `auditLog` entry, matching the other two callables.

### Digest history
`dailySummaries` for the branch, newest first — this is exactly the "read one document per business day" case the architecture note describes, now genuinely cheap because the collection is one small doc per day, not a query over raw records.

## Screens

### 1 · Dashboard
Live tiles: open exceptions (by severity), missed checks today, cash position, temperature status, staffing gaps, certifications expiring. A "Close business day" button for managers, only enabled once the business day's `closesAt` has passed (closing early would freeze a rollup for a day still in progress).

### 2 · Digest history
Past `dailySummaries`, newest first — the same numbers the dashboard showed at the moment each day closed, frozen.

## Security rules — the shape

```
match /dailySummaries/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow write: if false;   // Cloud Function only, via Admin SDK — never a client write path
}

match /mail/{id} {
  allow read, write: if false;   // Cloud Function only; the Trigger Email extension also uses Admin SDK
}
```
Both collections are **write-never from a client, by design** — the whole point of running the rollup server-side is that it needs full-collection reads a manager's own claims shouldn't grant, and a client-writable `dailySummaries` would let anyone fabricate the one document the owner actually reads at a glance.

## Acceptance criteria

**Live dashboard**
- [ ] Every tile reads current state directly — no tile depends on `dailySummaries` existing for today
- [ ] The certifications-expiring tile shows "not set" when `staff.certification_expiry_warning_days` is unset, and never a fabricated number

**Close business day**
- [ ] Only a manager (or above) can call `closeBusinessDay`; a station or crew account is refused
- [ ] Calling it writes exactly one `dailySummaries` document, sets the business day to `closed`, and produces an `auditLog` entry
- [ ] A missing mail-delivery configuration does not make the close fail
- [ ] No client code path can write `dailySummaries` directly — only the callable function, verified in rules

**Digest history**
- [ ] Past digests remain readable regardless of whether the mail extension is installed
- [ ] The numbers shown are exactly what was written at close — never recomputed on read
