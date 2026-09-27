# 19 — M14 · Purchase orders

**Build this after M12 and M13.** A purchase order needs a real supplier (M12) to exist against, and — when it's not standalone — a real *approved* purchase request (M13) to be built from. This is the module where money actually gets committed; everything before it was flagging a need or maintaining a list.

## Why this is where the real decision lives

M13 deliberately kept supplier choice and cost out of a purchase request — a requester flags *what's needed*, not *who to buy it from or at what price*. This module is where that decision actually gets made: a manager picks a real supplier, sets a real unit cost per line, and the resulting document is the one this codebase treats as an actual commitment, not a suggestion. That's also why creation here is manager-only even for a "standalone" order with no request behind it at all — unlike M13, where anyone could flag a need, nobody but a manager gets to commit the business to a spend.

**Why a PO doesn't just inherit its lines from the request that spawned it.** A request's line is "5 cases of Shin Ramyeon" — a quantity, nothing else. A manager building the order from that request might order a different quantity (case pricing changed the math), split it across two suppliers, or add something the requester didn't think to ask for. So creating a PO "from" an approved request pre-fills the form with that request's lines as a starting point, not a locked-in mirror — the PO's own lines are independent from the moment they're created, and the link back to the source request (`sourcePurchaseRequestId`) exists purely for traceability, the same way `InventoryMovement.sourceId` (M11) traces a stock change back to what caused it without the two documents staying mechanically in sync afterward.

**Why status only ever moves forward, and receiving stays manual for now.** The lifecycle (`draft → sent → confirmed → partially_received → received`, or `cancelled` from any of the first three) is a manager manually advancing a flag on this document — nothing here talks to `ReceivingLogPage` yet. `partially_received` and `received` becoming an automatic side effect of an actual delivery being logged is explicitly M15's job (`docs/06-ROADMAP.md`: *"a completed delivery closes out the matching PO line(s)"*), which needs the three-way match this module deliberately doesn't attempt yet. Until M15 ships, a manager marking a PO "received" is a statement of fact they're vouching for by hand, the same honest-constraint posture `docs/09-M4-CASH-CONTROL.md` already takes about this codebase not knowing a live cash balance it hasn't been told.

## What it does

1. `g7-ops` gains a `purchaseOrders` collection: supplier, line items with quantity and unit cost, status, and (when relevant) which purchase request it came from.
2. A **Purchase orders** screen (manager-tier to create/edit; any signed-in user can read, since M15 will need a station account preparing to receive a delivery to see what was actually ordered) lists every PO with its status and total.
3. Creating a PO offers two starting points: from an approved, not-yet-ordered purchase request (pre-fills lines from it), or blank. Either way, a real supplier and a real unit cost per line are required before it can be saved past `draft`.
4. `PurchaseRequest` (M13) gains one field — `linkedPurchaseOrderId: string | null` — set the moment a PO is created from it, so an approved request doesn't silently get turned into two separate orders by two managers who didn't see each other's work.
5. A manager can advance a PO's status forward (`draft → sent → confirmed → partially_received → received`) or cancel it, from `draft`, `sent`, or `confirmed` only — not from `received` (already done) or `cancelled` (already terminal) — same reasoning `IncidentRecord`'s own `open → escalated → closed` lifecycle already uses for closing off backward or reopened transitions.

## Screens

### 1 · Purchase orders (`g7-ops`)

List: supplier, status, total cost, line count. A manager sees a **New purchase order** button; everyone else sees the list read-only. Tapping an order opens its detail — lines (item, quantity, unit cost, line total), status, and (manager only) the controls to advance status or cancel.

### 2 · Create purchase order (`g7-ops`, manager-tier)

Two entry points, same form underneath:
- **From a request** — pick from approved requests with no `linkedPurchaseOrderId` yet; their lines pre-fill (item, quantity) with unit cost left blank for the manager to enter.
- **Standalone** — blank form.

Either way: pick a real supplier (active suppliers only, M12), add/edit/remove lines (real item, quantity, unit cost), save as `draft`. Saving sets `linkedPurchaseOrderId` on the source request, if there was one.

## Data model

```ts
type PurchaseOrderLine = {
  itemId: string       // items/{id} — a real M10 item, never free text
  itemName: string      // snapshot at order time
  qtyOrdered: number
  unitCostCentavos: number
}

type PurchaseOrderStatus = 'draft' | 'sent' | 'confirmed' | 'partially_received' | 'received' | 'cancelled'

type PurchaseOrder = OperationalBase & {
  supplierId: string
  supplierName: string   // snapshot at order time, same reasoning as PurchaseRequestLine.itemName
  lines: PurchaseOrderLine[]
  totalCentavos: number  // sum of qtyOrdered * unitCostCentavos across lines, computed at save time — not a live-derived field, since a line only ever changes by editing the order itself
  status: PurchaseOrderStatus
  sourcePurchaseRequestId: string | null  // traceability only — see Why, above
  cancelledReason: string | null          // set only when status becomes 'cancelled'
}
```

Addition to `PurchaseRequest` (M13):

```ts
linkedPurchaseOrderId: string | null   // set once a PO is created from this request; null = not yet ordered
```

Add `PurchaseOrder` to `docs/02-DATA-MODEL.md` alongside the other M-numbered collections.

## Logic

**Status only ever moves forward.** The allowed transitions are `draft → sent`, `sent → confirmed`, `confirmed → partially_received`, `partially_received → received`, and `cancelled` from `draft`, `sent`, or `confirmed`. Every other transition — including any attempt to move backward, or to touch a PO already `received` or `cancelled` — is rejected, enforced in `firestore.rules` itself via an explicit allow-list of `(before, after)` status pairs, not left to the UI to merely hide the wrong buttons.

**A PO's lines are frozen once past `draft`.** Editing quantities, costs, or the supplier is only possible while `status == 'draft'` — once sent to a supplier, the order is a real commitment and shouldn't silently change underneath whoever's tracking it against a physical delivery later. Needing to change a sent order is a cancel-and-recreate, not an edit.

**`totalCentavos` is computed once, at save time, not read live.** A PO is a snapshot of what was agreed, not a running calculation — the same reasoning `PurchaseRequestLine.itemName` is frozen at request time rather than joined live against the current item name.

## Security rules — the shape

```
match /purchaseOrders/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow create: if isManager()
                 && sameBranch(request.resource.data.branchId)
                 && request.resource.data.actorId is string
                 && request.resource.data.createdAt == request.time
                 && request.resource.data.status == 'draft';
  allow update: if isManager()
                 && sameBranch(resource.data.branchId)
                 && isValidStatusTransition(resource.data.status, request.resource.data.status);
  allow delete: if false;
}
```

`isValidStatusTransition` is a small rules helper encoding exactly the allow-list from Logic above — the same "don't trust the UI to be the only thing enforcing this" posture `items/{id}`'s M10 rule already takes for its own three-field allow-list.

`purchaseRequests/{id}`'s existing M13 update rule needs no change — `linkedPurchaseOrderId` is just one more field a manager's update can set, and that rule doesn't enumerate specific fields the way `items/{id}` does.

## Acceptance criteria

**Creating an order**
- [ ] A manager can create a standalone PO with a real supplier and at least one line
- [ ] A manager can create a PO from an approved, not-yet-linked request — lines pre-fill with item and quantity, unit cost starts blank
- [ ] Creating a PO from a request sets that request's `linkedPurchaseOrderId`
- [ ] An approved request that already has a `linkedPurchaseOrderId` no longer appears in the "from a request" picker
- [ ] A cashier or station account cannot create a PO, even bypassing the UI
- [ ] A PO cannot be created with a status other than `draft`

**Editing**
- [ ] Lines, supplier, and cost are editable while `status == 'draft'`
- [ ] None of the above are editable once `status` has left `draft`

**Status lifecycle**
- [ ] Each forward transition in the sequence succeeds in order
- [ ] Any attempt to skip a stage, move backward, or change a `received` or `cancelled` order is rejected — by the rules themselves, not just hidden UI
- [ ] Cancelling is possible from `draft`, `sent`, or `confirmed`, and requires `cancelledReason`
- [ ] Cancelling is rejected from `partially_received` or `received`

**End-to-end**
- [ ] Approve a purchase request (M13), build a PO from it, advance it through every status to `received` — the request's `linkedPurchaseOrderId` points at the right order throughout
- [ ] A PO's `totalCentavos` matches the sum of its lines at the moment it was saved, and does not change if an item's live price changes afterward in the catalogue (M10)
