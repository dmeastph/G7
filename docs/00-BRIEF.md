# 00 — Brief

## What we are building

> A branch operations system that records and enforces the controls already written in the G7 Operations Manual — cold chain, cash, checklists, people, incidents — and surfaces what needs attention today.

Every scope argument is settled against that sentence. If a proposed feature is not a control in the manual, or a way of seeing one, it does not go in.

## The business, in one paragraph

G7 Korean Mart is a Korean-style convenience store with a ramyeon station and light cooked-snack preparation — cooked rice for gimbap, kimchi fried rice, tteokbokki, boiled eggs and fried items. It sits beside a school gate in Imus, Cavite. It opens with **9 staff** (1 Store Manager, 2 Shift Leaders, 1 Kitchen Staff, 2 Cashiers, 3 Store Staff) trading **06:00–24:00**, seven days, moving to 24/7 once overnight demand is proven. It is designed from day one to be repeatable across branches.

## Non-goals — do not build these

| Not building | Why |
|---|---|
| **A POS** | A third-party POS runs the store. G7's own POS is a separate parallel project with BIR registration implications. This system never rings a sale or issues a receipt |
| **Payroll computation** | SSS, PhilHealth, Pag-IBIG, withholding, 13th month, OT and night-differential premiums are regulated and audited. This system produces **verified hours**; payroll is computed elsewhere |
| **Accounting or P&L** | The accountant's domain |
| **Inventory and FEFO** | Later phase. Blocked on an item master that does not exist yet |
| **POS sales import and margin analytics** | Later phase. Blocked on the POS decision. Reserve the keys, build nothing |
| **Loyalty or CRM** | Later phase. Personal data, no current need |
| **CCTV video** | The system records *that* a clip was preserved, by whom, until when. It never touches footage |
| **Native mobile apps** | A PWA does everything needed, with no app store and no release process |

## Constraints that shape every decision

**1. One non-specialist maintainer.** Edward, with Claude Code. No engineering team. Boring and obvious beats clever, every time.

**2. Paper is always the fallback.** All 24 forms are printed and in the store. System down means the store trades on paper and data is entered later. **If the system ever prevents trading, it gets switched off.**

**3. The floor is offline-hostile.** Temperature readings, cash records, checklists, incidents and clock-in must all work with no connection and sync afterwards.

**4. Branch-scoped from row one.** One branch today. Retrofitting multi-branch is among the most expensive rewrites in retail software.

**5. Append-only.** Nothing operational is deleted or edited. Corrections are reversals with a reason. This is what makes the data usable in a cash dispute, an insurance claim or a health inspection.

**6. One tablet at launch.** Placed at the cold aisle / ramyeon station, because temperature logging is the check most likely to be written from memory if the device is a walk away. The UI must be fast on a mid-range Android tablet and usable with wet hands and one thumb.

## The ten modules

| # | Module | Status |
|---|---|---|
| M0 | Foundation — branch, users, roles, PIN, parameters, audit, offline shell | **Spec complete — build first** |
| M1 | Cold chain and equipment | **Spec complete — build second** |
| M2 | Checklists and exceptions | Outlined |
| M3 | Time, roster and certification | Outlined |
| M4 | Cash control | Outlined |
| M5 | Incidents | Outlined |
| M6 | Shift handover | Outlined |
| M7 | Document control | Outlined |
| M8 | Dashboard and daily digest | Outlined |
| M9 | Employee self-service and leave | Outlined |

## Rollout

The system does **not** launch the same week as the store.

| Stage | When | What |
|---|---|---|
| Cold chain early | During equipment commissioning | M1 live before the store trades |
| Paper only | First 2–3 weeks of trading | The team learns the discipline, not an app |
| Parallel | Weeks 3–6 | One module per week, digital **and** paper |
| Digital primary | Week 6+ | System is the record; paper stays printed as fallback |

Build accordingly: **M1 must be independently useful with no other module present.**
