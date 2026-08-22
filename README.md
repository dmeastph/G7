# G7 Operations System

Branch operations system for G7 Korean Mart — see `CLAUDE.md` for the full brief and hard rules, `docs/` for the module specs, and `RUNBOOK.md` for setup and operational procedures.

**Status: M0-M9 built — all ten modules on the roadmap are complete.** Foundation, Cold chain, Checklists and exceptions, Time/roster/certification, Cash control, Incidents, Shift handover, Document control, Dashboard and daily digest, Employee self-service and leave. See `docs/06-ROADMAP.md` for the module list and `docs/` for each one's full spec.

## Quick start

```
npm install
firebase emulators:start   # terminal 1
npm run seed                # terminal 2, once
npm run dev                 # terminal 2
```

Then see `RUNBOOK.md` → "First-time project setup" for bootstrapping a real Firebase project, the owner account, and the station device.

## Commands

```
npm run dev          # local dev server (against emulators, per .env)
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint
npm run emulators     # Firebase emulator suite
npm run test:rules    # Firestore security rules tests (emulator must be running)
npm run seed           # load branch/roles/templates/users/parameters
npm run seed-equipment # load the branch's actual equipment list (thresholds unset)
```

`HANDOFF_README.md` is the original handoff package's own readme, kept for reference.
