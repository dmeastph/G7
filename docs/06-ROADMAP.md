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

## Later phases — do not build

**Phase 2** — inventory and FEFO, once an item master exists.
**Phase 3** — POS sales import, once the POS is selected. The schema reserves `shiftInstanceId` and `businessDayId` on POS entities. Reserve the keys, build nothing.
**Phase 4** — multi-branch scorecards.
**Phase 5** — loyalty and CRM.

## Backlog

Anything proposed but out of scope goes here rather than into the current module. Add a line, keep building.

- _(empty)_
