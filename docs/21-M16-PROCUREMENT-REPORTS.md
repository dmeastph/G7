# 21 — M16 · Procurement reports

**Build this after M15.** Every number this module shows already exists somewhere in `purchaseOrders`, `suppliers`, or `items` — this is a read-only view over data M10 through M15 already collect, not a new source of truth for anything.

## Why this follows `g7-pos`'s own reports pattern, not a new one

`g7-pos/docs/11-C4-REPORTS.md` and its `ReportsPage.tsx` already settled the shape a reports screen takes in this codebase: one page, a dimension tab-switcher, each dimension backed by a small pure function in its own `lib/*Reports.ts` file that takes raw data in and returns an aggregated shape out — no dimension's logic reaches into React state or Firestore directly. `g7-ops` has never had a reports screen of its own; this module is the first, and it follows that exact shape rather than inventing a second one. Four dimensions, four tabs: open PO aging, spend by supplier/category/time, supplier on-time-delivery percentage, and low-stock alerts.

**Why two small fields get added to `PurchaseOrder`, not just computed from what's already there.** Three of the four dimensions need nothing new — aging is just `createdAt` versus now, spend is just summing existing lines, and low-stock already exists as the Dashboard's own card (M11) and this module just gives it a fuller table alongside the others. On-time delivery is different: "on time" is meaningless without something to compare *against*. Nothing in `purchaseOrders` today records when a delivery was actually expected, or exactly when it was actually completed — `status` becoming `'received'` (M15) is an event, not a timestamp. So this module adds exactly two fields: `expectedDeliveryDate`, optionally set by a manager when creating or editing a still-draft order, and `receivedAt`, stamped the moment M15's own `onReceivingRecordCreated` trigger closes an order out. Both are additive and optional — an existing PO with neither keeps working exactly as it does today, it just can't contribute to the on-time percentage, the same way an item with no `reorderPoint` (M10/M11) is silently excluded from low-stock rather than counted as a failure.

## What it does

1. `PurchaseOrder` gains `expectedDeliveryDate` (settable on the existing create/edit-while-draft form, M14) and `receivedAt` (stamped automatically, M15's trigger).
2. A new **Reports** screen (`g7-ops`, manager-tier — the same tier `g7-pos`'s own reports screen is gated at) with four tabs:
   - **Open orders** — every PO not yet `received` or `cancelled`, aged from `createdAt`, bucketed.
   - **Spend** — total committed spend (`sent` status onward — a `draft` order isn't a commitment yet, a `cancelled` one never was), grouped by supplier, by item category, or by month.
   - **On-time delivery** — per supplier, the percentage of their fully-received orders that arrived on or before `expectedDeliveryDate`, counting only orders where both that field and `receivedAt` are set.
   - **Low stock** — the same `qtyOnHand <= reorderPoint` list the Dashboard card (M11) already surfaces, here as a full sortable table rather than a compact card.

## Screens

### Reports (`g7-ops`, manager-tier)

One page, a tab row across the top (mirroring `g7-pos/src/modules/reports/ReportsPage.tsx`'s own `DimensionTabs`), one table per tab. No date-range picker on day one — every dimension here is either a current snapshot (open orders, low stock) or an all-time aggregate (spend, on-time %); a range picker is real, later work if "spend last quarter" turns out to matter, not something to fake now.

## Data model

Additions to `PurchaseOrder` (M14):

```ts
expectedDeliveryDate: string | null   // YYYY-MM-DD, optional, set on the existing create/edit form
receivedAt: Timestamp | null          // stamped by onReceivingRecordCreated (M15) the moment status becomes 'received'
```

No new collections. Every report is computed from `purchaseOrders`, `suppliers`, and `items`, already fully populated by M10–M15.

## Logic

**All four dimensions are pure functions, not live Firestore queries with aggregation baked in** — each takes the already-subscribed `purchaseOrders`/`items`/`suppliers` arrays (the same client-side pattern `DashboardPage`'s `useDashboardData` and `g7-pos`'s own report helpers already use) and returns a computed shape. This keeps every dimension unit-testable without a live database, the same reasoning `catalogueSync.ts` (M10) was split out as pure diff logic in the first place.

**Spend-by-category joins against `items`' *current* category, not a snapshot.** `PurchaseOrderLine` only stores `itemId`/`itemName`, not category — if an item's category changes in `g7-pos` after an order shipped, that order's historical spend reports under the item's category *as of today*, not as of the order date. Worth knowing, not worth solving here: a true point-in-time category snapshot would mean copying yet another field onto every line for a report that's read rarely, not the kind of thing this codebase's own "don't add a field until something real needs it" posture supports yet.

**On-time is `receivedAt`'s calendar date <= `expectedDeliveryDate`, both required.** A `cancelled` order, a `draft` never sent, or a `received` order with no `expectedDeliveryDate` ever set are all silently excluded from the percentage — none of them are a broken promise, since none of them had one.

## Acceptance criteria

**Open orders**
- [ ] Every PO in `draft`, `sent`, `confirmed`, or `partially_received` appears, aged correctly from `createdAt`
- [ ] A `received` or `cancelled` PO never appears here

**Spend**
- [ ] A `draft` order contributes nothing to any spend total; a `cancelled` order contributes nothing either
- [ ] Grouping by supplier, category, and month each sum to the same grand total
- [ ] Editing an item's category in the Catalogue screen changes how *already-placed* orders for that item report, going forward — confirming the "current category, not a snapshot" behavior is real, not just documented

**On-time delivery**
- [ ] A supplier with no orders carrying both `expectedDeliveryDate` and `receivedAt` shows no percentage, not 0% or 100%
- [ ] A late delivery (`receivedAt` after `expectedDeliveryDate`) correctly counts against the percentage
- [ ] A same-day delivery counts as on time

**Low stock**
- [ ] Matches the Dashboard card's own list exactly, for the same data, at the same moment

**End-to-end**
- [ ] Set an `expectedDeliveryDate` on a new PO, send it, receive it a day late — the on-time percentage for that supplier reflects the miss
- [ ] An older PO created before this module shipped (no `expectedDeliveryDate`, no `receivedAt`) appears correctly in Open orders / Spend, and is correctly excluded from On-time delivery
