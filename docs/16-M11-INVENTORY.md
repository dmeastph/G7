# 16 — M11 · Inventory

**Build this after M10.** Everything here is keyed to the `items` collection M10 created — there is no stock-on-hand ledger to build without a stable item to hold it against.

## Why a ledger, not a running number you edit directly

The naive version of inventory is a single `qtyOnHand` field a manager edits by hand when stock changes. That throws away the one thing that makes stock numbers trustworthy later: *why* they changed. The first time a count looks wrong, "wastage or a bad receiving or a typo two weeks ago?" needs an answer, and a bare number has none.

So this module is a ledger first, a number second: every change to stock is its own record (`inventoryMovements`) — what changed, by how much, and why — and `qtyOnHand` on the item itself is a derived total the server maintains from that ledger, never hand-edited directly. This is the same shape this codebase already uses for `dailySummaries` (`docs/13-M8-DASHBOARD-DIGEST.md`) and `CatalogueSyncDoc` (`docs/15-M10-ITEM-MASTER.md`): a server-owned aggregate, with the events that produced it kept as their own auditable trail.

## What's in scope now, and what isn't

**In scope:** wastage (already logged, M2) and a new manual consumption entry both post negative movements. Reorder point (already a field on `ItemDoc` since M10, unused until now) gets compared against `qtyOnHand` for low-stock detection, surfaced on the dashboard.

**Deliberately not in scope:** receiving does **not** post positive movements yet. `ReceivingLogPage`'s items are free-text (`ReceivingItem.name: string`, no item reference) — there's no reliable join key to post against without the three-way-match rework `docs/06-ROADMAP.md` already schedules as M15. Wiring receiving in now would mean guessing at name-matching between free text and real items, which is exactly the kind of silent-drift bug the M10 sync avoided by matching on a real ID instead of SKU. Inventory goes live slightly one-sided (movements out, not yet in) until M15 closes the loop — a smaller, correct system now beats a bigger, unreliable one.

## What it does

1. `g7-ops` gains an append-only `inventoryMovements` collection — one document per stock change, never edited or deleted after creation.
2. `ItemDoc` (M10) gains a `qtyOnHand` field, maintained only by a Cloud Function trigger reacting to new movements — never writable by a client, the same way `ItemDoc`'s synced fields are already closed to client writes.
3. `WastageRecord` (M2) gains an optional `itemId` field. When set, a Firestore trigger posts a negative movement automatically. Existing and future wastage entries with no linked item behave exactly as they do today — this is additive, not a breaking change to a screen already in daily use, the same posture M10 took with receiving-that-would-become-M15.
4. A new **manual consumption** entry (a new small collection, `consumptionEntries`) — for stock leaving for a reason that isn't wastage (staff meals, samples, internal use) — always requires a real item, since there's no legacy free-text behavior to preserve here.
5. The dashboard (M8) gains a low-stock card: any item with both `reorderPoint` and `qtyOnHand` set, where `qtyOnHand <= reorderPoint`.
6. A new **Inventory** screen shows stock-on-hand per item and its recent movement history.

## Screens

### 1 · Inventory (`g7-ops`, manager-tier read)

Lists every `item` with `qtyOnHand`, `reorderPoint`, and a low-stock marker when `qtyOnHand <= reorderPoint`. Tapping an item opens its movement history — the same after-the-fact review pattern as M10's sync history, not a live approval gate. `reorderPoint` itself stays editable on the existing Catalogue screen (M10) — one field, one place to edit it, not duplicated here.

### 2 · Wastage log (`g7-ops`, existing screen from M2, extended)

`WastageLogPage` gains an item picker (autocomplete against `items`, matching on `name`), optional — a manager can still type a free-text item name for something not in the catalogue (a one-off, or a category the catalogue doesn't track), same as today. Picking a real item sets `itemId`, which is what makes the movement post automatically.

### 3 · Log consumption (`g7-ops`, new)

A small form: item (required, real item only — a picker, not free text), quantity, reason. No temperature check or condition fields — this isn't a delivery, it's stock leaving for an internal reason. Same tier as wastage logging (any signed-in user, per `docs/03-M0-FOUNDATION.md`'s existing pattern for M2 logs — this is a record of what happened, not a privileged action).

### 4 · Dashboard (`g7-ops`, existing screen from M8, extended)

New "Low stock" card, same visual pattern as the existing exception/incident counts already there: item name and how far under reorder point it is. Empty state when nothing is low, not a hidden card — an empty low-stock card is itself useful information ("nothing to reorder right now").

## Data model

```ts
// Append-only — nothing here is ever edited or deleted after creation.
// The one source of truth for "why did stock change."
type InventoryMovement = OperationalBase & {
  itemId: string                 // g7-ops's own items/{id} — not sourceItemId
  delta: number                  // negative = stock leaving, positive = stock arriving (unused until M15)
  reason: 'wastage' | 'manual_consumption' | 'receiving' | 'adjustment'
  sourceCollection: 'wastageRecords' | 'consumptionEntries' | 'receivingRecords' | null
  sourceId: string | null        // the record that caused this movement, when there is one
  note: string
}

// New, small — consumption that isn't wastage and isn't a sale (g7-ops has no sales).
type ConsumptionEntry = OperationalBase & {
  itemId: string
  qty: number
  reason: string
}
```

Additions to existing types:

```ts
// ItemDoc (docs/15-M10-ITEM-MASTER.md) gains:
qtyOnHand: number   // server-maintained only, via the trigger below. Starts at 0 for every item.

// WastageRecord (docs/02-DATA-MODEL.md, M2) gains:
itemId: string | null   // null = untracked, exactly today's behavior. Set = posts a movement.
```

Add `InventoryMovement` and `ConsumptionEntry` to `docs/02-DATA-MODEL.md`, and the two field additions above to `ItemDoc`'s and `WastageRecord`'s existing entries there, per that doc's role as the single source of truth for shapes.

## Logic

**`qtyOnHand` is never client-writable, under any role.** The only way it changes is a Cloud Function trigger (`onInventoryMovementCreated`) reacting to a new `inventoryMovements` document: read the item, apply `delta` inside a Firestore transaction (concurrent movements on the same item — a wastage entry and a manual consumption logged seconds apart — must not race and drop one), write the new `qtyOnHand`. This is the same reasoning `ItemDoc`'s synced fields already use in M10: a value only one thing is allowed to write is a value that can't silently drift.

**Wastage posts a movement only when `itemId` is set.** `onWastageRecordCreated` (Firestore trigger on `wastageRecords/{id}`): if `itemId` is null, do nothing — today's untracked behavior, unchanged. If set, create an `inventoryMovements` document with `delta: -qty`, `reason: 'wastage'`, `sourceCollection: 'wastageRecords'`, `sourceId` the wastage record's own id. `qty`'s unit isn't reconciled against the item's `unitOfPurchase` (M10) — that reconciliation is real future work, not something this module silently gets wrong by pretending it's solved.

**Consumption entries always post a movement** — `onConsumptionEntryCreated` does the same as above, unconditionally, since `itemId` is required at write time (enforced in both the UI and the security rules, not just the UI).

**No stock movement ever fails silently.** If the trigger's transaction fails (the referenced item was deleted — it shouldn't be, since M10 never deletes items, but nothing stops a manual Firestore console edit), the error is logged the same way a failed catalogue sync is (`docs/15-M10-ITEM-MASTER.md`'s own precedent) rather than thrown back at a user who has no way to act on it — the wastage or consumption record itself already saved successfully by the time this runs, the same "the primary action already succeeded, don't retroactively fail it" posture M10's handover trigger takes.

**Low stock is `qtyOnHand <= reorderPoint`, both non-null.** An item with no `reorderPoint` set (the default, per M10) is never flagged — silence here means "not configured," not "fine," and the Inventory screen's own list still shows the actual `qtyOnHand` for any item a manager wants to check regardless of whether it's flagged.

## Security rules — the shape

```
match /inventoryMovements/{id} {
  allow read: if signedIn();
  allow create, update, delete: if false;   // Cloud Functions only, via the Admin SDK
}
match /consumptionEntries/{id} {
  allow read: if signedIn();
  allow create: if signedIn() && request.resource.data.itemId is string;
  allow update, delete: if false;           // append-only, like wastageRecords already is
}
```

`items/{id}`'s existing M10 rule (`hasOnly(['reorderPoint', 'defaultSupplierId', 'unitOfPurchase'])` for a manager's update) needs no change — `qtyOnHand` isn't in that allow-list, so it's already unwritable by any client without touching the rule at all. That the M10 rule needed no change to stay correct here is a small proof the M10 design held up under a real second module building on it.

## Acceptance criteria

**Movements ledger**
- [ ] A movement document, once created, cannot be updated or deleted by any client role
- [ ] Two movements on the same item created within the same second both apply correctly — neither is lost to a race
- [ ] `qtyOnHand` cannot be set directly by any client write, including a manager

**Wastage integration**
- [ ] Logging wastage with no item picked behaves exactly as before M11 — no movement, no error
- [ ] Logging wastage with a real item picked creates exactly one movement with `delta` equal to `-qty`
- [ ] An existing (pre-M11) wastage record with no `itemId` is unaffected — no retroactive movement is created for it

**Manual consumption**
- [ ] Submitting without a real item selected is rejected by both the UI and the rules
- [ ] A successful submission creates exactly one movement and updates `qtyOnHand` correctly

**Low stock**
- [ ] An item with `reorderPoint` null never appears in the low-stock card, regardless of `qtyOnHand`
- [ ] An item with `qtyOnHand` exactly equal to `reorderPoint` is flagged (boundary is inclusive)
- [ ] The low-stock card shows an explicit empty state when nothing qualifies, not a hidden/missing card

**End-to-end**
- [ ] Starting from `qtyOnHand: 0`, logging three wastage entries and one manual consumption against the same item leaves `qtyOnHand` at the correct negative-sum total, with four matching `inventoryMovements` documents
- [ ] Setting a `reorderPoint` on the Catalogue screen (M10) immediately affects whether that item shows as low stock, with no separate save step needed on the Inventory screen
