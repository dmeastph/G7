# G7 Operations System

You are building the branch operations system for **G7 Korean Mart**, a Korean convenience store with a ramyeon station and light cooked-snack preparation, in Imus, Cavite, Philippines. It opens with **9 staff**, trading **06:00–24:00**, moving to 24/7 later.

Read `docs/00-BRIEF.md` before writing any code. Then `docs/01-ARCHITECTURE.md` and `docs/02-DATA-MODEL.md`. Build from `docs/03-M0-FOUNDATION.md`, then `docs/04-M1-COLDCHAIN.md`.

---

## The one thing to understand

This system **records and enforces controls that already exist on paper.** A complete 71-page Operations Manual, a 55-page Training System and a 24-page printed Forms Pack are in use. The software does not invent process — it digitises process that is already written down and already running.

**Every module has a printed paper fallback.** If the system is down, the store trades on paper and data is entered later. This is why an ops system is being built rather than a POS: a POS outage stops the store; an ops system outage is an inconvenience.

**If the system ever prevents the store from trading, it is switched off.** Design accordingly.

---

## Who maintains this

One non-specialist owner (Edward) working with Claude Code. There is no engineering team, no on-call, and no one to page at 5pm on a Friday.

Every decision optimises for **maintainable by one person with an AI assistant** over elegance, cleverness or theoretical scale. Concretely:

- Boring, obvious code beats clever code. Always.
- No abstraction that exists only for hypothetical future needs.
- No dependency added without a clear reason. Prefer the platform.
- Comment *why*, never *what*.
- If a thing can be done with 20 lines of plain React or 200 lines of a framework abstraction, write the 20 lines.

---

## Hard rules

1. **Branch-scoped from row one.** Every operational document carries `branchId`. There is one branch today; there will be more. Never write code that assumes a single branch.
2. **Append-only.** Nothing operational is deleted or edited in place. Corrections are new documents that reference the original with a reason. Never `delete()` an operational record.
3. **Every operational write carries five fields:** `branchId`, `shiftInstanceId`, `actorId`, `createdAt`, `deviceId`. Enforce this in a shared write helper, not by remembering.
4. **Configuration over code.** Every threshold, limit, interval, fee and temperature comes from the `parameters` collection. **Never hardcode an operating value.** If you find yourself typing `3000` or `60`, stop and read a parameter.
5. **Offline must work** for temperature readings, checklists, cash records, incidents and clock-in. Firestore offline persistence handles the queue — do not build your own.
6. **Never invent a food-safety or legal number.** Values marked *to be set* in the parameter seed stay unset and the UI shows them as unset. A plausible-looking fabricated threshold in a food-safety record is worse than a visible gap.

---

## Stack

React 18 + Vite + TypeScript · Firebase (Firestore, Auth, Storage, Functions) · Vercel via GitHub · PWA, installable, offline-capable.

This mirrors an existing project the owner already runs and deploys (`git push` → Vercel). Do not propose Next.js, a different database, or a different host.

## Structure

```
src/
  modules/          one folder per module — coldchain/, cash/, checklists/, ...
  lib/              firebase.ts, auth.ts, params.ts, write.ts, offline.ts, audit.ts
  components/       shared UI primitives only
  routes/           route definitions
functions/          Cloud Functions
docs/               these specs — keep them current
```

**Do not build this as one large file.** Ten modules with an audit trail will not survive it. Module folders own their own components, hooks and types; cross-module imports go through `lib/`.

## Conventions

- TypeScript strict. No `any` without a comment explaining why.
- Firestore document types live in `src/lib/types.ts` and are the single source of truth.
- All Firestore access goes through `src/lib/write.ts` and per-module data hooks. **No raw `setDoc` in a component.**
- Times stored as Firestore `Timestamp` (UTC). Displayed in `Asia/Manila`. Never store a formatted date string.
- Money in whole centavos as integers. Never floats for currency.
- Temperatures in Celsius, one decimal place, stored as numbers.
- Currency displays as `₱1,234.50`.

## Commands

```
npm run dev          # local
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint
npm run emulators    # Firebase emulator suite
```

Run `npm run typecheck` before saying anything is done.

## What NOT to build

A POS · payroll computation · accounting · inventory and FEFO (later phase) · loyalty or CRM · anything that touches CCTV video. See `docs/00-BRIEF.md` for the full list and why.

If a feature seems useful but is not in the current module spec, **add it to `docs/06-ROADMAP.md` under Backlog and move on.** Scope creep is the largest risk to this project.
