# G7 Operations System — Build Handoff

This is the complete specification for building the G7 branch operations system. It is written to be dropped into an empty repository and handed to Claude Code.

## How to use it

1. Create an empty repo, copy this whole folder in.
2. Open Claude Code in the repo. It will read `CLAUDE.md` automatically.
3. Say: **"Read the docs folder, then build M0."**
4. When M0 passes its acceptance criteria, say: **"Build M1."**

## What is in here

| File | What it is |
|---|---|
| `CLAUDE.md` | Project context and conventions. Claude Code reads this every session |
| `docs/00-BRIEF.md` | What we are building, what we are not, and the constraints |
| `docs/01-ARCHITECTURE.md` | Stack, auth model, offline strategy, deployment |
| `docs/02-DATA-MODEL.md` | Firestore collections, document shapes, security rules |
| `docs/03-M0-FOUNDATION.md` | **Build this first.** Full spec with acceptance criteria |
| `docs/04-M1-COLDCHAIN.md` | **Build this second.** Full spec with acceptance criteria |
| `docs/05-PARAMETERS.md` | Seed data — every operating value, ready to load |
| `docs/06-ROADMAP.md` | M2–M9 outlines, and the backlog |

## Source documents

These specs derive from documents that already exist and are in use. Where this pack and those documents disagree, **those documents win** and this pack is corrected.

- **G7 Operations Manual v1.2** — the rules. Appendix A is the parameter table; Appendix G is food safety.
- **G7 Training System v1.2** — certification levels L1–L5, which the roster module enforces.
- **G7 Operations Forms Pack v1.1** — the 24 printed forms this system digitises. Every screen has a paper twin.

## Order of build

M0 foundation → M1 cold chain → M2 checklists → M3 time, roster, certification → M4 cash → M5 incidents → M6 handover → M7 documents → M8 dashboard → M9 self-service.

**M1 is first for a reason.** It is usable during equipment commissioning, before the store trades at all. The store has already had one freezer fail and be replaced. This module earns its keep before opening day.
