# 03 — M0 · Foundation

**Build this first. Nothing else works without it.**

M0 is not user-facing. It is the shell, the identity model, the parameter layer, the audit trail and the offline plumbing. Every later module depends on getting it right, and the cost of getting it wrong compounds.

## Deliverables

1. Vite + React + TypeScript project, deploying to Vercel on `git push`
2. Firebase project wired: Firestore, Auth, Storage, Functions, emulators
3. PWA — installable, offline-capable, with an offline indicator
4. Managed-account sign-in with role custom claims
5. Station device sign-in and PIN identification, working offline
6. Parameter layer with the full seed loaded
7. Audit log with every write passing through one helper
8. Business day and shift instance model, with today's shift resolvable
9. App shell: navigation, offline banner, actor display, error boundary
10. Seed script and Firestore rules with emulator tests

## Build order within M0

**1. Project skeleton.** Vite + React + TS. Path aliases. `npm run typecheck`, `lint`, `emulators`. Deploy an empty page to Vercel and confirm `git push` works before writing anything else.

**2. Firebase wiring.** `src/lib/firebase.ts` initialises with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })`. Emulator connection when `import.meta.env.DEV`.

**3. Types.** `src/lib/types.ts` from `02-DATA-MODEL.md`. Firestore converters for each collection.

**4. Auth.**
- Managed sign-in — email and password.
- A Cloud Function `setUserRole` writes custom claims. Callable by `owner` only. Seed the first owner manually via the Admin SDK and document how in the runbook.
- Station sign-in — a dedicated account per branch with claims `{ role: 'station', branchId }`. Signs in once, stays signed in.
- `src/lib/auth.ts` exposes `useAuth()` → `{ mode: 'managed'|'station'|'none', user, claims, branchId }`.

**5. PIN layer.**
- `src/lib/pin.ts`. On station mode and online, cache `{ userId, displayName, roles, pinHash }` for active users of the branch into IndexedDB. Refresh on reconnect and at least daily.
- `verifyPin(pin)` → user or null, **entirely local**, bcrypt compare.
- `usePinSession()` holds the current actor. **The session expires after `session.pin_timeout_minutes` of inactivity** (parameter, default 15) and on shift close.
- A persistent header shows the current actor and a one-tap **Switch user**.
- PINs are set and reset only by a manager, via a Cloud Function that hashes server-side.

**6. Parameters.**
- `src/lib/params.ts` → `useParam(key)` returns `{ value, isSet, dataType, unit, requiresProfessionalSignoff }`.
- Resolution order: `shift_template` → `branch` → `global`, filtered by `effectiveFrom/To`.
- Cached in memory and offline-available.
- **`isSet === false` must render as "not set", never as a fallback number.** Provide `<ParamValue paramKey="..." />` that does this correctly, and use it everywhere.
- Manager UI to view and edit, respecting `minAllowed`/`maxAllowed`, requiring a `reason`, writing a new document and closing the old one.
- Editing a `requiresProfessionalSignoff` parameter shows a confirmation naming the professional who must sign it off.

**7. Write helper.** `src/lib/write.ts`:
```ts
writeOperational<T>(collectionName: string, data: T): Promise<string>
```
Stamps `branchId`, `businessDayId`, `shiftInstanceId`, `actorId`, `actorName`, `createdAt`, `deviceId`. Writes the document, then appends an `auditLog` entry in the same batch. Throws if there is no actor.

Also `correctOperational(collectionName, originalId, data, reason)` — writes a **new** document with `correctsId` and `correctionReason`. Never mutates the original.

**8. Business day and shift.**
- `src/lib/businessDay.ts` — resolve the current business day from `branch.businessDayCutoff`. In `scheduled` mode the day ends at `closeTime`; in `24_7` mode at the cutoff. **Write this once, correctly, and never compute a business day anywhere else.**
- Ensure today's `businessDay` and its `shiftInstances` exist — created lazily on first use, or by a scheduled function.
- `useCurrentShift()` → the active shift instance.
- Manual override for a manager, in case the automatic resolution is ever wrong.

**9. App shell.** Bottom navigation (thumb reach, tablet in a wall mount). Offline banner with pending-write count. Actor chip with switch-user. Error boundary that logs to Firestore and shows a plain recovery message, never a stack trace.

**10. Seed and rules.** `scripts/seed.ts` loads branch 001, roles, shift templates, the nine users with placeholder PINs, and every parameter from `05-PARAMETERS.md`. Rules from `02-DATA-MODEL.md` with emulator tests.

## Acceptance criteria

M0 is done when every one of these is demonstrably true.

**Deployment**
- [ ] `git push` to `main` deploys to Vercel with no manual step
- [ ] `npm run typecheck` passes with zero errors
- [ ] The app installs as a PWA on an Android tablet and opens from the home screen

**Auth and identity**
- [ ] A manager signs in with email and password and their role claim resolves
- [ ] The station account signs in and stays signed in across an app restart
- [ ] With **wifi turned off**, a staff PIN is accepted and sets the actor
- [ ] A wrong PIN is rejected and the failure is recorded
- [ ] The PIN session expires after the configured timeout
- [ ] Switching user takes at most two taps

**Parameters**
- [ ] All seeded parameters load and are readable offline
- [ ] `cash.drawer_max_balance` returns **₱3,000**
- [ ] `food.hot_holding_min_c` returns **60**
- [ ] `equipment.freezer_target_max_c` reports **not set** — and **no number is displayed anywhere for it**
- [ ] A manager changes a parameter with a reason; the old value is retained with `effectiveTo` set
- [ ] A value outside `minAllowed`/`maxAllowed` is rejected with a clear message
- [ ] A non-manager cannot open the parameter editor, and the rules reject the write even if the UI is bypassed

**Write path and audit**
- [ ] Every write through `writeOperational` carries all five stamps
- [ ] Every write produces exactly one `auditLog` entry
- [ ] A correction creates a new document and leaves the original untouched
- [ ] No code path anywhere calls `deleteDoc` on an operational collection
- [ ] Rules tests prove update and delete are refused on `temperatureReadings` and `auditLog`

**Business day and shift**
- [ ] Today's business day resolves correctly in `scheduled` mode
- [ ] Changing `branch.operatingMode` to `24_7` with a `04:00` cutoff produces the correct boundary, **and an overnight timestamp at 01:00 belongs to the previous business day**
- [ ] `useCurrentShift()` returns the right shift at 08:00 and at 20:00
- [ ] A manager can override the resolved shift

**Offline**
- [ ] With wifi off: the app opens, the PIN works, a test write succeeds and is queued
- [ ] The offline banner shows the pending-write count
- [ ] On reconnect, queued writes land and the banner clears
- [ ] Killing and reopening the app while offline does not lose queued writes

**Multi-branch safety**
- [ ] Every seeded document has a `branchId`
- [ ] The station account for branch 001 cannot read branch 002 data — proven by a rules test

## Do not build in M0

Any screen that records operational data. That is M1 onward. M0 ships when the plumbing is right, and a test write is the only write it makes.
