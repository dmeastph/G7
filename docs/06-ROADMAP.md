# 06 — Roadmap

M0 and M1 are fully specified. Everything below is outlined only. **Write the full spec for a module before building it**, following the shape of `03` and `04` — screens, logic, acceptance criteria.

Each module ships something usable on its own. Nothing waits for everything.

## M2 · Checklists and exceptions
Versioned templates · scheduled runs (opening, closing, 20/30/60-minute checks) · pass/fail/numeric/photo responses · missed-run detection · the exception engine completed. Also the small logs: queue escalation, wastage, receiving.
**Paper twins:** G7-F-01, F-02, F-09, F-10, F-11, F-12, F-13, F-18.

## M3 · Time, roster and certification
Clock in and out on the station device with photo · breaks · actual versus rostered · **night-differential hours computed separately** (22:00–06:00, relevant from day one) · rest days · verified hours export.
Roster builder with coverage view against target headcount.
Certification register from the Training System — L1 to L5, plus Module F food certification.
**The control that matters:** the roster refuses to assign an uncertified person to the till, and enforces the three cover tests — an L4 present, an L3 on the drawer, and someone Module F certified whenever prepared food is sold.
**Paper twin:** G7-F-17.

## M4 · Cash control
Drawer sessions bound to one named person · opening float · **blind count** — the expected figure is not shown until the count is submitted · safe drops with bag numbers and chain of custody · manager receipt confirmation · variance with investigation threshold · void, refund, override and no-sale exceptions.
**Paper twins:** G7-F-04, F-05, F-06.

## M5 · Incidents
Typed capture · severity · narrative · immediate action · **CCTV preservation register** with cameras, time range, clip reference and retain-until date · escalation · closure with root cause.
**Paper twin:** G7-F-14.

## M6 · Shift handover
Handover pack generated from the shift's own data · acceptance by the incoming leader · carry-forward with automatic escalation after three shifts.
**Paper twin:** G7-F-03.

## M7 · Document control
Manual and SOP versions · read-and-acknowledge · who has acknowledged what · branch applicability.
**Paper twin:** G7-DOC-02.

## M8 · Dashboard and daily digest
Live view — open exceptions, missed checks, cash position, temperature status, staffing gaps, certifications expiring.
**Daily digest** — one message to the owner at close with the day's numbers and anything unresolved. Highest value per hour of build time in the project.
**Paper twin:** G7-F-16.

## M9 · Employee self-service and leave
Personal login on own phone · own hours, roster, certifications, night-differential accrued · **leave requests with a coverage check** showing the approver what the roster looks like if granted · **time-record disputes** — the employee cannot edit, but can flag, and the manager records a correction as a new entry.
Leave entitlement begins at regularisation (6 months). Model **company leave** and **statutory SIL** (12 months) as separate configurable entitlements.

---

## M10 · Item master (bridge)

**Promoted off the "do not build" list, 2026-09-05.** This roadmap originally deferred inventory on "once an item master exists" — that precondition is the module below. `g7-pos` has been selected and is live, which also lifts the gate on M3 below.

One canonical product list in `g7-ops`, built as a **one-way bridge** from `g7-pos`'s existing item catalogue rather than a second item master maintained by hand. `g7-pos` stays the place staff actually add/edit products (that's already built and in daily use); `g7-ops` gets a synced read-only copy to hang inventory, receiving and purchasing against.

**Decision, not a default:** the two systems are on deliberately separate Firebase projects (`g7-pos` docs/13-DEPLOYMENT.md's own reasoning). A live, unauthenticated cross-project read from the browser was considered and rejected — it reopens that separation. What's built instead: **automatic sync, fired by every accepted shift handover** (M6) — roughly 3 times a day given the M/A/G roster, server-to-server (a `g7-ops` Cloud Function calls a `g7-pos` Cloud Function using a shared secret, never from the browser), applied directly with no live review gate. Safety comes from the sync logic itself, not a human in the loop: a missing item is always flagged, never deleted. A manual "Sync now" button runs the identical logic on demand. Needs a one-time shared-secret setup across both projects (same category of step as the Vertex AI IAM grant in `g7-pos`'s own deployment history, simpler in kind). Full spec: `docs/15-M10-ITEM-MASTER.md`.

**Paper twin:** none — this is new scope, not a paper-form digitisation.

## M11 · Inventory

**Spec written, 2026-09-06 — see `docs/16-M11-INVENTORY.md`.** Stock-on-hand ledger keyed to the M10 item master. Receiving (M15) posts positive movements; wastage (already logged in M2) and manual consumption entries post negative ones. Reorder point per item, low-stock surfaced on the dashboard (M8) and in reports (M16).

## M12 · Suppliers

**Spec written, 2026-09-06 — see `docs/17-M12-SUPPLIERS.md`.** Real master data, replacing the free-text supplier name `ReceivingLogPage` (M2) has used until now: name, category, contact info, certifications, payment terms, active status. Existing receiving records keep their free-text value; only new records reference a real supplier.

## M13 · Purchase requests

**Spec written, 2026-09-06 — see `docs/18-M13-PURCHASE-REQUESTS.md`.** Staff request items/quantities/need-by date. Approval follows `leaveRequests`' own already-shipped pattern (anyone can create, only a manager can update — gated in `firestore.rules`, not just the UI). An approved PR is the only path into M14.

## M14 · Purchase orders

Created from an approved PR (or standalone, manager-only), against a real supplier (M12), with per-line quantity and unit cost. Status lifecycle: draft → sent → confirmed → partially received → received → cancelled. `poId` is the join key M15 needs to close the loop.

## M15 · Receiving becomes a real three-way match

Extends the *existing* `ReceivingLogPage` (M2) rather than replacing it. "Quantity ordered" per line comes from the referenced PO instead of being hand-typed; a completed delivery closes out the matching PO line(s) and posts a receipt into M11's inventory ledger automatically. A receiving record with no PO reference still works exactly as it does today — this is additive, not a breaking change to a screen already in daily use.

## M16 · Procurement reports

New tabs on the reporting pattern `g7-pos` already ships (docs cross-reference: `g7-pos/docs/11-C4-REPORTS.md`): open PO aging, spend by supplier/category/time, supplier on-time-delivery percentage, low-stock/reorder alerts from M11.

## M17 · Purchase/demand forecast

Reorder quantity and timing suggestions from M11's consumption trend. Deliberately last — meaningless without real inventory history to learn from. **Not sales forecasting** — that would require `g7-ops` to see `g7-pos`'s actual sales data, which the same separate-projects decision above currently prevents. Revisit only if that's genuinely wanted; it is a materially bigger scope change than anything else on this list.

---

## Later phases — do not build

**Phase 4** — multi-branch scorecards.
**Phase 5** — loyalty and CRM.

## Backlog

Anything proposed but out of scope goes here rather than into the current module. Add a line, keep building.

- _(empty)_
