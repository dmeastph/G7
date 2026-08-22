# 04 — M1 · Cold chain and equipment

**Build this second. It is the first thing anyone actually uses.**

## Why this one first

G7 has already had a freezer fail during setup — it held −18°C, then only −4°C, rose to +1°C in defrost, with heavy ice build-up and meat still inside. It was replaced. That incident is why this module exists in this form.

M1 is **usable during equipment commissioning, before the store trades at all**. It earns its keep before opening day, in front of a small audience, at low stakes. That is a rare property and the reason it goes first.

**M1 must work with no other module present.** Do not couple it to checklists, cash or rostering.

## What it does

1. Equipment register with asset IDs, per-unit thresholds, warranty and service history
2. Temperature readings on the three-hour cycle, offline-first, with optional photo
3. Automatic excursion detection and timing
4. Quarantine that blocks release to anyone without the permission
5. Maintenance tickets that cannot close without verification
6. A cold-chain status view

## Screens

### 1 · Equipment register
List of units by zone with current status and last reading. Manager can add and edit; crew read-only.

Each unit: assetId (printed on the physical unit), type, make, model, serial, supplier, purchase date, warranty expiry, zone, whether it requires a temperature log, thresholds, and threshold source.

**Thresholds may be unset.** Show "target not set" plainly. Never invent one, and never let an unset threshold block a reading.

### 2 · Take readings — the most important screen in the app

This is used eight times a day by tired people, sometimes with wet hands, on a wall-mounted tablet. It is the screen to obsess over.

- One tap from the home screen
- All units needing a log, listed, showing **due**, **done** or **overdue** for the current slot
- Tap a unit → big numeric keypad → save. **Target under 20 seconds from home screen to saved.**
- Show the target range if set; show the last reading for context
- Optional photo, compressed client-side
- On save, if outside range: **immediate, unmissable** prompt — *"This is out of range. Tell the Shift Leader now."* — with a one-tap **Open excursion**
- Works fully offline; queued readings visibly marked as pending

**Two anti-patterns to design out, deliberately:**

**Do not pre-fill the previous reading.** Convenient, and it produces logs full of identical numbers, which is exactly the falsified record the manual warns about.

**Flag suspicious patterns rather than blocking them.** If three consecutive readings for a unit are identical to one decimal place, set `duplicateFlag` and surface it on the manager's review — do not stop the save. The crew member may be telling the truth, and blocking a save teaches people to work around the system.

### 3 · Excursion
Opens automatically when a reading breaches a set threshold; can be opened manually.

Shows the clock running since `startedAt`. Records the seven first checks as a checklist — door open, overloaded or blocked, ice build-up, defrost cycle, power interruption, gasket damaged, setpoint changed, plus nothing-found and free text.

Two paths: **recovered** (record cause and action, close) or **not recovered** (quarantine stock, raise a ticket).

> **The setpoint warning is a required UI element.** On the excursion screen, prominently: *"Do not change the setpoint. That is not a fix — it is a decision to sell warm stock."* Manual Module I says this; the software says it at the moment it matters.

### 4 · Quarantine
List of lots with item, quantity, estimated value, location and status.

**Disposition requires `stock.release_quarantine`** — `store_manager` and `owner` only. Enforced in rules, not just UI.

Four outcomes: released, discarded, returned to supplier, held pending technician. **`basis` is a required free-text field** on any outcome — the manual requires the reasoning to be recorded, not just the decision.

Discarding links to a wastage record (stub in M1; M2 completes it).

Quarantined lots appear on the cold-chain status view until dispositioned, and stay visible on the manager's daily review.

### 5 · Maintenance ticket
Raise from a unit or from an excursion. Symptom in plain words, trade impact, whether stock is at risk.

Response fields: technician, times, diagnosis, work done, parts, warranty, cost, downtime, preventive advice.

**Cannot close without `verifiedWorkingBy`.** Enforce it.

Show `warrantyExpiry` from the equipment record when raising — it is the moment someone needs to know.

### 6 · Cold-chain status
One screen: every unit, last reading, time since, in or out of range, open excursions, open quarantine, open tickets, and readings missed today.

This is what the Store Manager looks at each morning.

## Logic

**Slot generation.** From `equipment.temperature_reading_interval_minutes` (default 180) and the branch operating hours. A reading is **due** in its slot, **overdue** after `equipment.reading_grace_minutes` (default 45), **missed** at the end of the slot. A missed reading creates an `exception` at severity `medium`.

**Excursion open.** On a reading where thresholds are set and `valueC < minC || valueC > maxC`, if no open excursion exists for that unit, create one, set `startReadingId`, and create an `exception` at severity `high`. If one is already open, update `peakC`.

**Excursion recovery.** A subsequent in-range reading sets `endedAt` and `durationMinutes` and moves status to `recovered`. It does **not** auto-close — a human records the cause and closes it.

**Auto-quarantine.** If `maxExcursionMinutes` is set and the excursion exceeds it, set status `quarantined`, escalate the exception to `critical`, and prompt for affected lots. **If `maxExcursionMinutes` is unset, do not auto-quarantine** — surface it to the Shift Leader instead. Never invent the threshold.

**Offline.** Readings, excursions and quarantine all queue. Excursion detection runs client-side so it works offline. Server-side re-evaluation on sync catches anything missed.

## Acceptance criteria

**Equipment**
- [ ] A manager creates a unit with an asset ID and it appears in the register
- [ ] A unit with `thresholds: null` shows "target not set" and **no number appears anywhere**
- [ ] Crew cannot edit equipment; the rules refuse the write even if the UI is bypassed

**Readings**
- [ ] Home screen → reading saved in **under 20 seconds**, measured on the actual tablet
- [ ] Due, overdue and missed states are correct for the current slot
- [ ] The previous reading is **not** pre-filled
- [ ] A reading on a unit with no thresholds saves, with `withinRange: null`
- [ ] Three identical consecutive readings set `duplicateFlag` and **still save**
- [ ] Photo attaches, compresses to under 300KB, and uploads on reconnect
- [ ] **Wifi off:** reading saves, shows as pending, and lands on reconnect

**Excursions**
- [ ] An out-of-range reading opens an excursion automatically and creates a `high` exception
- [ ] The setpoint warning is visible on the excursion screen without scrolling
- [ ] The seven first checks record
- [ ] An in-range reading marks it `recovered` but does **not** close it
- [ ] Closing requires a cause and a closer
- [ ] Exceeding `maxExcursionMinutes` auto-quarantines and escalates to `critical`
- [ ] With `maxExcursionMinutes` unset, **no auto-quarantine happens** and the Shift Leader is prompted
- [ ] **Wifi off:** an out-of-range reading still opens the excursion locally

**Quarantine**
- [ ] Crew can create a quarantine lot
- [ ] Crew **cannot** release one — UI hidden **and** rules reject the write
- [ ] A manager can release, and `basis` is required
- [ ] Released, discarded, returned and pending all record correctly
- [ ] Open lots remain visible on the status view until dispositioned

**Tickets**
- [ ] Raising from an excursion links them
- [ ] Warranty expiry shows when raising
- [ ] A ticket **cannot** close without `verifiedWorkingBy`
- [ ] Closed tickets stay on the unit's service history

**Audit**
- [ ] Every reading, excursion, quarantine and ticket write produces an `auditLog` entry
- [ ] No update or delete path exists on readings
- [ ] A correction creates a new reading with `correctsId`, and the original is still visible

**End-to-end, on the real tablet, wifi off**
- [ ] Take readings for every unit · one out of range · excursion opens · seven checks recorded · quarantine a lot · raise a ticket · reconnect · everything lands · audit trail complete and attributed to the right person
