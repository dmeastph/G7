# 15 — M10 · Item master (bridge)

**Build this before M11–M17. Nothing downstream — inventory, receiving-matching, purchase orders, reports — has anything to key against without it.**

## Why a bridge, not a second item master

`g7-pos` already has a real, in-daily-use item catalogue (`ItemsPage`/`ItemFormDialog`) — name, SKU, barcode, category, price, VAT class, modifiers. Building a second one by hand in `g7-ops` would mean two product lists drifting apart from day one, maintained by two different people in two different apps.

The two systems are on **deliberately separate Firebase projects** (`g7-pos/docs/13-DEPLOYMENT.md`'s own stated reasoning: each Phrocure system gets its own project, nothing shared). A live, unauthenticated cross-project *read* was considered and rejected — that would mean `g7-ops`'s client SDK reaching directly into `g7-pos`'s Firestore, which reopens a boundary that was closed on purpose. A **scheduled server-to-server call, gated by a shared secret** is a narrower thing than that, and is what this module builds.

**What this module is, precisely:** an automatic sync, fired by the shift handover that already exists (M6) — every handover **accepted** by an incoming leader triggers a catalogue sync as a side effect, roughly 3 times a day given the M/A/G roster, with no one needing to remember to run it. A manual **"Sync now"** button exists too, for the case where a manager changed prices in `g7-pos` and doesn't want to wait for the next handover — same underlying function, human-triggered instead of event-triggered.

Under the hood: a `g7-ops` Cloud Function calls a `g7-pos` Cloud Function server-to-server (never from the browser — the shared secret that authorizes the call never reaches a client), fetches the current active catalogue, and applies it directly. **No live human review gate** — this runs unattended most of the time, so it can't wait on someone reading a diff. What keeps this safe without one: a missing item is always *flagged*, never deleted (see Logic below), so the one genuinely destructive outcome a bad sync could cause is designed out regardless of whether anyone was watching when it ran. Every run's summary (new/changed/missing counts) is kept as its own record, reviewable after the fact — a manager finds out what changed at the next dashboard check, not by having had to approve it in the moment.

**One-time setup this needs, not ongoing maintenance:** `g7-pos` exposes a plain HTTPS Cloud Function (not a Firebase Auth–gated callable — a server calling from `g7-ops`'s project has no `g7-pos` Firebase Auth identity to present, so the two functions authenticate to each other with a shared secret instead, stored in each project's own function config/secret manager, never in client code or in this repo). Setting that secret in both projects is a one-time step needing direct access to both Firebase projects — the same category of step the Vertex AI IAM grant was in `g7-pos`'s own deployment history, simpler in kind: a secret value, not an IAM role binding across projects.

**`g7-pos` remains the source of truth for what an item *is*** (name, price, category — staff already maintain these there). **`g7-ops`'s copy is for what an item *does* operationally** — reorder point, supplier, unit of purchase — fields that only make sense on the operations side and were never going to live in the till's own catalogue.

## What it does

1. `g7-pos` gains a plain HTTPS Cloud Function that returns the active catalogue as JSON, callable only with the shared secret — no UI on the `g7-pos` side at all, this is server-to-server plumbing, not a manager-facing action.
2. `g7-ops` gains a Firestore trigger: every `shiftHandovers` document whose `status` transitions to `'accepted'` fires a catalogue sync automatically.
3. `g7-ops` also gains a manual **Sync now** button on a new Catalogue screen, calling the identical sync logic on demand.
4. `g7-ops`'s own `items/{itemId}` document adds the operational fields M11–M15 need, which survive a sync — a sync does **not** wipe `reorderPoint`, `defaultSupplierId`, or `unitOfPurchase` on an item that already exists.
5. Every run — handover-triggered or manual — writes a `CatalogueSyncDoc` (what changed) and an `auditLog` entry, and stamps `lastSyncedAt` on the branch/dashboard so a manager can see "catalogue last synced N hours ago" at a glance.

## Screens

### 1 · Export endpoint (`g7-pos`, no UI)

A plain HTTPS Cloud Function (`exportItemMasterHttp`), not a Firebase-Auth-gated callable — the caller is `g7-ops`'s own Cloud Function, which has no `g7-pos` Firebase Auth identity to present. Authorizes the request by checking a shared-secret header against a value in `g7-pos`'s own function config; refuses anything else, including a request with no header at all.

Returns JSON: for each active item, `{ itemId, sku, barcode, name, category, priceCentavos, vatClass }`, plus the server's own timestamp for when the export was generated. `itemId` is `g7-pos`'s own Firestore document ID — this is the field the two sides match on.

**Deliberately excluded:** `modifierGroupIds`, `quickKeyPosition`, `imageUrl`, `isCookedNoodle`, `ageRestricted` — real fields on `g7-pos`'s item, but till-specific presentation/behavior with no operational meaning on the `g7-ops` side. Bringing them over would be exactly the kind of premature, unused field this system's own conventions rule out elsewhere.

### 2 · Handover-triggered sync (`g7-ops`, no UI)

`onShiftHandoverAccepted`, a Firestore trigger on `shiftHandovers/{id}`. Fires when `status` changes from `'pending'` to `'accepted'` — the moment the incoming leader actually takes the shift, not when the pack was merely generated. Calls the shared `runCatalogueSync()` function (below). Failure here **never blocks the handover itself** — the handover has already been accepted by the time this runs; a sync failure is logged and recorded as a failed `CatalogueSyncDoc`, not surfaced as an error to the person accepting the handover, who has nothing to do with the catalogue.

### 3 · Catalogue (`g7-ops`)

A new screen, manager-tier read (`store_manager`/`ops_head`/`owner`), listing `g7-ops`'s current items:

- Synced fields (name, SKU, category, price, VAT class) shown read-only, with a visible marker on any item flagged `presentInLatestExport: false`.
- Operational fields (`reorderPoint`, `defaultSupplierId` — null until M12, `unitOfPurchase`) editable inline by a manager.
- **Sync now** button — calls `syncCatalogueNow` (an `onCall` wrapping the same `runCatalogueSync()` the handover trigger uses), manager-gated the same way `closeDrawerSession`/`setUserRole` already are in this codebase.
- A sync history panel: the last several `CatalogueSyncDoc` records, each showing when, what triggered it (`handover` or `manual`), and the new/changed/missing counts — this is the after-the-fact review the design relies on instead of a live approval gate.

## Data model

```ts
// g7-ops's own items collection — new, not a mirror of g7-pos's Item type.
// Synced fields come from the last sync; operational fields are set here
// and survive every future sync untouched.
type ItemDoc = {
  // Synced from g7-pos — never hand-edited in g7-ops.
  sourceItemId: string          // g7-pos's own document ID; the join key
  sku: string
  barcode: string | null
  name: string
  category: string
  priceCentavos: number
  vatClass: 'vatable' | 'vat_exempt' | 'zero_rated'
  presentInLatestExport: boolean // false = missing from the most recent sync

  // Set in g7-ops, survive every sync untouched.
  reorderPoint: number | null
  defaultSupplierId: string | null   // null until M12 (suppliers) exists
  unitOfPurchase: string | null      // e.g. "case of 24" — free text until a real need for structure shows up

  active: boolean
  lastSyncedAt: Timestamp | null     // null until the first successful sync
  createdAt: Timestamp
}

// One per sync run, not per item — the audit trail for "what happened, when, why."
type CatalogueSyncDoc = {
  trigger: 'handover' | 'manual'
  triggeredBy: string | null        // handover's acceptedBy uid, or the manager who pressed Sync now
  triggeredByName: string | null
  handoverId: string | null         // set when trigger === 'handover'
  sourceExportedAt: string          // the timestamp g7-pos's export response carried
  status: 'ok' | 'failed'
  errorMessage: string | null       // set when status === 'failed' — e.g. secret mismatch, g7-pos unreachable
  newCount: number
  changedCount: number
  missingCount: number
  createdAt: Timestamp
}
```

Add both to `docs/02-DATA-MODEL.md` alongside the other M-numbered collections when this is built, per that doc's own role as the single source of truth for shapes.

## Logic

**Matching key.** `sourceItemId` (g7-pos's Firestore document ID) is the join key, not SKU. SKU can be edited or left blank on some items (`g7-pos`'s own `Item` type allows a null barcode and doesn't enforce SKU uniqueness at the rules layer); the document ID is the one thing guaranteed stable across an item's life in `g7-pos`.

**`runCatalogueSync(trigger, triggeredBy)` — the one function both paths call:**
1. Fetch `g7-pos`'s export endpoint with the shared secret. On any failure (network, bad secret, non-2xx), write a `CatalogueSyncDoc` with `status: 'failed'` and the error, and stop — never partially apply.
2. Diff against `g7-ops`'s current `items`:
   - *New*: `sourceItemId` in the fetched payload, not in `g7-ops`.
   - *Changed*: `sourceItemId` in both, and any of `name`/`category`/`priceCentavos`/`vatClass`/`barcode` differs.
   - *Missing*: `sourceItemId` in `g7-ops` with `presentInLatestExport: true`, not in the fetched payload.
3. Apply in one batch: create new items, update synced fields on changed ones, flag missing ones `presentInLatestExport: false`. Operational fields are never touched by this step.
4. Write one `CatalogueSyncDoc` with `status: 'ok'` and the three counts, and an `auditLog` entry.

**No automatic deactivation, ever — this is the safety property the whole "no live review" design leans on.** A missing item is flagged, never auto-deactivated or deleted — it could be missing because it was genuinely discontinued, or because someone ran a sync mid-edit on the `g7-pos` side. That distinction needs a human, the same reasoning `docs/04-M1-COLDCHAIN.md` already applies to duplicate-reading detection: flag, don't decide for them. Because this can run unattended three times a day, this rule is load-bearing, not a nicety.

**A sync failure never blocks the handover.** The Firestore trigger runs *after* the handover document already shows `status: 'accepted'` — there is no path back from a sync failure to un-accept a handover, nor should there be. The incoming leader sees their handover accepted normally regardless of what the catalogue sync does.

**The shared secret never reaches the browser.** `runCatalogueSync` runs server-side in `g7-ops`'s own Cloud Functions, reads the secret from its own function config, and calls `g7-pos`'s export endpoint directly — no client, including the manager pressing "Sync now," ever sees or transmits it.

## Acceptance criteria

**Export endpoint (`g7-pos`)**
- [ ] A request with the correct shared-secret header returns the active catalogue as JSON
- [ ] A request with a missing or wrong secret is refused
- [ ] The response contains only active items, only the five synced fields, no till-specific presentation fields
- [ ] The response carries a server-generated export timestamp

**Handover-triggered sync (`g7-ops`)**
- [ ] Accepting a `shiftHandovers` document (status → `'accepted'`) fires exactly one sync
- [ ] A handover created but not yet accepted does **not** fire a sync
- [ ] Re-saving an already-accepted handover (no status change) does **not** fire a second sync
- [ ] `g7-pos` unreachable during a handover-triggered sync: the handover still shows `accepted` normally, and a `CatalogueSyncDoc` with `status: 'failed'` is recorded
- [ ] `CatalogueSyncDoc.trigger` is `'handover'` and `handoverId` is set for this path

**Manual sync (`g7-ops`)**
- [ ] "Sync now" runs the identical diff/apply logic as the handover trigger
- [ ] `CatalogueSyncDoc.trigger` is `'manual'` and `handoverId` is null for this path
- [ ] Cashier-tier roles cannot see or call "Sync now"; the `onCall` function rejects the call even if invoked directly, bypassing the UI

**Diff and apply, either trigger**
- [ ] A brand-new sync (empty `g7-ops` catalogue) creates every fetched item as *new*
- [ ] Running the sync again immediately, nothing changed in `g7-pos`, produces zero new/changed/missing
- [ ] Changing a price in `g7-pos`, then syncing, updates exactly that item's `priceCentavos` in `g7-ops` and counts it as *changed*
- [ ] Deactivating an item in `g7-pos`, then syncing, flags it `presentInLatestExport: false` in `g7-ops` and does **not** delete it
- [ ] The apply step is one atomic write — killing the connection mid-run never leaves a partially-applied sync
- [ ] `reorderPoint`, `defaultSupplierId`, `unitOfPurchase` set before a sync are unchanged after it, for every item still present in the fetched payload

**Catalogue screen**
- [ ] Synced fields render but have no edit control
- [ ] Operational fields save independently of any sync
- [ ] An item flagged `presentInLatestExport: false` is visibly marked as such
- [ ] Sync history shows trigger type, timestamp, and counts for at least the last several runs, including failed ones

**End-to-end**
- [ ] Accept a real shift handover with `g7-pos` reachable — confirm the catalogue in `g7-ops` reflects `g7-pos` afterward, matched on `sourceItemId`
- [ ] Add a new item in `g7-pos`, accept a handover, confirm exactly one *new* item lands correctly
- [ ] Press "Sync now" as a non-manager role (bypassing the UI) and confirm it's refused
