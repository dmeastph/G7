# 01 — Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| UI | React 18 + Vite + TypeScript | The owner's existing stack |
| Data | **Firestore** | **Offline persistence is built in.** This is the hardest requirement in the project and Firestore solves it almost for free |
| Auth | Firebase Auth | Already known |
| Files | Firebase Storage | Photo evidence |
| Server | Cloud Functions (Node) | Scheduled rollups, digest, PIN hash management |
| Hosting | Vercel via GitHub | `git push` deploys. Nothing new to learn |
| App | PWA, installable | No app store, no release process |

### The honest trade-off

Firestore is a document store and this data is relational — shift instances joined to readings joined to equipment. Postgres would model and query it better.

**Firestore is chosen anyway** because free offline sync is worth more here than query elegance, and because it is a stack the owner already operates.

**The mitigation is daily rollups.** Dashboards read one `dailySummaries` document per branch per business day, written on close. They never aggregate raw records. Raw records exist for audit and export.

## Authentication — two tiers, and be clear about what each one is

### Tier 1 — Managed accounts (the security boundary)

Store Manager, Operations Head and Owner sign in with **Firebase Auth email + password** on their own device. Role comes from a **custom claim** set by a Cloud Function.

The shop-floor tablet also holds a managed account: a dedicated **station account** for the branch, with claims `{ role: 'station', branchId: '001' }`. It signs in once and stays signed in.

**Security rules are written against these claims. This is the real access control.**

### Tier 2 — Staff PIN (attribution, not authorisation)

Crew do not have work email and cannot log in and out of a shared tablet all shift. Each person has a **4–6 digit PIN** used to stamp `actorId` on every action.

**Be explicit about what this is.** The PIN identifies *who did it*; the station account authorises *that it may be done at all*. A PIN is not a security boundary and must never be treated as one.

**PIN verification is local, so it works offline.** The device caches, per branch: `{ userId, displayName, roles, pinHash }` for active staff, refreshed whenever online. Hash with **bcrypt (cost ≥ 10)**.

> **The trade-off, stated plainly:** a stolen unlocked tablet exposes a bcrypt-hashed PIN list. For 9 staff with short PINs that is brute-forceable offline. It is accepted because (a) the station account, not the PIN, is what grants write access, (b) the alternative is a Cloud Function call that fails exactly when the store loses connectivity, which is when the logs matter most, and (c) every write is attributed and immutable, so misuse is visible. **Rotate all PINs if a device is lost.** Put that in the runbook.

## Offline

Enable Firestore persistence with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`.

| Must work offline | Degrades gracefully | Needs connection |
|---|---|---|
| Temperature readings | Photo upload (queues to Storage) | Dashboard and rollups |
| Cash counts and drops | Alerts (fire on reconnect) | Daily digest |
| Checklists | Handover acceptance (signs locally) | Roster changes |
| Incidents | | Parameter changes |
| Clock in and out | | Certification changes |

**Rules:**
- Local writes queue and are never lost. **Never build a custom sync queue** — Firestore already does this and doing it twice creates two sources of truth.
- Conflicts resolve by **append, never overwrite.** Two people recording the same reading produces two documents and a duplicate flag, not one document that silently won.
- The UI shows a persistent **offline indicator** and a pending-write count. Staff must be able to see that their work is queued and not lost.
- Anything requiring connectivity is **disabled with an explanation**, never left to fail silently.

## Deployment

`main` → Vercel production. Preview deployments on branches.

Environment variables in Vercel. **Never commit Firebase config or service account keys.** Firestore rules and indexes live in the repo and deploy via the Firebase CLI.

**Rollback is a Vercel one-click revert to the previous deployment.** Document this in the runbook — it is the first thing the owner will need under pressure.

## Non-negotiable engineering rules

1. **One write helper.** `src/lib/write.ts` exports `writeOperational(collection, data)` which stamps `branchId`, `shiftInstanceId`, `actorId`, `createdAt`, `deviceId` and appends an `auditLog` entry. **No component calls `setDoc` directly.**
2. **One parameter reader.** `src/lib/params.ts` exports `useParam(key)`. No operating value is ever a literal in a component.
3. **No deletes.** There is no delete path for operational data. Corrections create a new document with `correctsId` and `reason`.
4. **Types are the contract.** `src/lib/types.ts` defines every document shape. Firestore reads are typed via converters.
5. **Every list view is paginated.** Never `getDocs` an unbounded collection.
6. **Photos are compressed client-side** before upload — max 1600px, JPEG quality 0.7. Storage cost is dominated by photos.

## Performance targets

The tablet is mid-range Android on shop wifi.

- First contentful paint under 2s on a cold load
- Temperature entry: open app → reading saved in **under 20 seconds**
- Every action gives feedback within 100ms, optimistically if needed
- Bundle under 300KB gzipped for the initial route
