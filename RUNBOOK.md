# Runbook

Operational procedures for Edward (the one maintainer). Written so you can follow it under pressure without re-deriving anything.

## First-time project setup

1. Create the Firebase project (Firestore, Auth, Storage, Functions enabled).
2. Copy `.env.example` to `.env` and fill in the Firebase web config (Project Settings → General → Your apps).
3. `npm install`, then `cd functions && npm install && cd ..`
4. Deploy rules, indexes and functions: `npx firebase deploy --only firestore:rules,firestore:indexes,storage:rules,functions`
5. **Bootstrap the first owner** (nothing else can — `setUserRole` requires an existing owner to call it):
   - Create the owner's Firebase Auth user by hand in the Firebase Console (Authentication → Add user), or `npx firebase auth:import` for one user.
   - `GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json npm run set-owner -- owner@example.com 001`
6. **Set up the station account** (the shop-floor tablet's login):
   - `GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json npm run setup-station -- station-001@g7.internal <a strong password> 001`
   - Sign in with that email/password once, on the tablet, in the app. It stays signed in.
7. **Seed data**: `GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json FIRESTORE_EMULATOR_HOST= npm run seed`
   - Prints the 9 placeholder staff PINs once, to the console. Rotate them (see below) before real staff use the tablet.
8. Connect the repo to Vercel (Vercel dashboard → New Project → this repo). Add the same `VITE_FIREBASE_*` env vars there, plus `VITE_USE_EMULATORS=false`.
9. `git push` to `main` — Vercel deploys automatically from then on.

## Local development

```
npm install
firebase emulators:start          # terminal 1 — Firestore/Auth/Storage/Functions emulators
npm run seed                      # terminal 2, once — seeds the emulator (FIRESTORE_EMULATOR_HOST is set by the emulator's own shell, or export it manually)
npm run dev                       # terminal 2 — Vite dev server, VITE_USE_EMULATORS=true in .env
```

`npm run typecheck` before saying anything is done. `npm run test:rules` runs the Firestore rules tests against a running emulator.

## Rollback

**Vercel one-click revert** is the first thing you need under pressure:

Vercel dashboard → this project → Deployments → find the last known-good deployment → **⋯ → Promote to Production**. Takes effect in seconds, no rebuild.

For a Firestore rules problem specifically: `npx firebase deploy --only firestore:rules` from a previous git commit (`git checkout <sha> -- firestore.rules && npx firebase deploy --only firestore:rules`), since rules deploy independently of the app.

## Rotating staff PINs

**Rotate all PINs immediately if a device is lost or an unlocked tablet goes missing** — the offline PIN cache is a bcrypt-hashed list on-device, brute-forceable offline for short PINs (this trade-off is accepted deliberately, see `docs/01-ARCHITECTURE.md`).

A manager, signed in with a managed account, calls the `resetUserPin` callable function per staff member (a manager-facing screen for this is not yet built in M0 — call it directly via the Firebase console's function tester, or script it):

```js
// one-off, from a trusted machine with the Firebase Admin SDK, or via the callable from a signed-in manager session
resetUserPin({ userId: '<Firestore doc id from users collection>', newPin: '1234', branchId: '001' })
```

The station device's cached PIN list refreshes automatically within 24h, or immediately on the next reconnect after a manager forces it (kill and reopen the app while online).

## Adding a manager or changing a role

Only an existing owner can do this (`setUserRole` is owner-only):

```
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json npm run set-owner -- newmanager@example.com 001
```

(`set-owner` sets role `owner` specifically — for other managed roles, call the `setUserRole` callable with the target role instead; there is no CLI wrapper for that yet.)

## Granting an employee personal access (M9)

There is no self-service sign-up — same controlled-onboarding pattern as the owner/station accounts. Only an owner can do this:

1. Create the employee's Firebase Auth user by hand (Console → Authentication → Add user, or `firebase auth:import` for one user) with their own email and a temporary password they'll change on first sign-in.
2. Find their existing `users`-collection doc id (Firestore Console, or query `employeeNo`).
3. Call `setUserRole` with their real role, this branch, **and** their `users` doc id — the third field links the personal login to their staff record in the same call:
   ```js
   setUserRole({ targetAuthUid: '<their new Firebase Auth uid>', role: 'cashier', branchId: '001', userId: '<their users-collection doc id>' })
   ```
4. They sign in on their own phone with that email/password and land on "My self-service" (`/self`) — own hours, roster, certifications, leave, and flagging a clock event they think is wrong.

Skipping the `userId` field still grants a working managed login (useful for a manager's own personal device), it just won't resolve a linked staff record, so `/self` will say the account isn't linked yet.

## Enabling the daily digest email (M8)

`closeBusinessDay` always writes the digest to `dailySummaries` (readable in-app under Dashboard → Digest history, no setup needed) and always queues a `mail/{id}` document addressed to the owner's account email. **Actually sending that mail needs the Firebase "Trigger Email" extension installed** (or equivalent — anything that watches the `mail` collection in the `{to, message: {subject, text}}` shape and sends via your own SMTP/API credentials):

1. Firebase Console → this project → Extensions → install **"Trigger Email"** (publisher: Firebase).
2. Point it at your SMTP provider (a transactional-email provider, or a Gmail account with an app password for low volume) — the extension asks for these at install time.
3. Leave its watched collection as the default `mail` — that's what `closeBusinessDay` writes to.

Nothing else changes. If this is never installed, the digest still exists and is still readable — closing a business day never depends on mail delivery succeeding (`functions/src/index.ts` catches and logs a mail failure without failing the close).

## Known M0 limitation — pending-write count

The offline banner's "N writes queued" figure is an approximation (Firestore doesn't expose an exact pending-write count) — see the comment in `src/lib/offline.ts`. It resets to 0 once the SDK confirms everything has synced, but between writes it can drift by a small amount. This has never blocked or lost a write; it is purely the displayed number.
