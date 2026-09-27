# 20 — M15 · Receiving becomes a real three-way match

**Build this after M14.** This is the module M11 and M14 both left a deliberate gap for: M11's `InventoryMovement.reason` already includes `'receiving'` and `sourceCollection` already includes `'receivingRecords'`, unused since the day M11 shipped; M14's own spec says outright that a manager marking a PO `partially_received`/`received` by hand is a stand-in *"until M15 ships."* This module is what actually wires the gap shut on both sides.

## Why this extends `ReceivingLogPage` again, not a third time from scratch

M11 added an optional item link to wastage. M12 added an optional supplier link to receiving. This module adds an optional *purchase order* link to that same screen — same additive posture each time: a receiving record with no PO reference still works exactly as it does today, free-text item names and all. Nothing about a screen that's been in daily use since M2 breaks the day this ships.

**Why "quantity ordered" stops being hand-typed only when a PO is linked.** Today, `ReceivingItem.qtyOrdered` is whatever the person receiving the delivery remembers or was told — useful, but not verifiable against anything. Once a real PO is picked, the outstanding quantity per line is a known fact sitting in `purchaseOrders` already; typing it by hand at that point would just be re-entering a number the system already has, with a chance to get it wrong. So a PO-linked line's ordered quantity is pulled from the PO and **locked** — not re-typeable — while quantity *received* stays exactly as freely editable as it's always been, because that's the one number only the person standing in front of the delivery actually knows.

**Why PO status stops being a manual button once this ships.** `partially_received` and `received` were a manager's honest statement they were vouching for by hand, per M14's own spec. Once a real delivery can post against a real PO line, that statement should come from the delivery actually happening, not from someone remembering to also go update a status separately. So this module **removes** the manual "mark partially received / mark received" controls from the PO detail screen and closes those two transitions off to client writes entirely in `firestore.rules` — from this point on, only the receiving trigger (Cloud Functions, Admin SDK, which bypasses client rules the same way every other server-only write in this codebase already does) can move a PO into either state. `draft → sent`, `sent → confirmed`, and cancelling stay exactly as manual as they've always been — those aren't receiving-driven facts.

## What it does

1. `ReceivingLogPage` gains an optional purchase-order picker — only POs currently awaiting delivery (`sent`, `confirmed`, or already `partially_received`) are pickable. Choosing one locks the supplier (a PO already committed to one) and pre-fills lines from that PO's still-outstanding quantities, each locked to a real item.
2. A new Cloud Function trigger, `onReceivingRecordCreated`, reacts to every new receiving record: for each line with a real item linked, it posts an `InventoryMovement` (`reason: 'receiving'`) the same way M11's wastage/consumption triggers already do — M11's existing `onInventoryMovementCreated` needs no changes at all to pick these up.
3. When the record is linked to a PO, the same trigger also updates that PO's matching line(s) with how much has now been received, and recomputes the PO's own status forward — `partially_received` once anything's arrived, `received` once every line is fully covered.
4. `firestore.rules`' M14 `purchaseOrders` update rule is tightened: a client (including a manager) can no longer set `status` to `partially_received` or `received` directly — those two values become reachable only through the Admin SDK trigger above.

## Screens

### `ReceivingLogPage` (`g7-ops`, existing screen, extended again)

A new picker above the existing supplier field: "Receiving against a purchase order (optional)," listing POs in `sent`/`confirmed`/`partially_received`. Picking one:
- Locks the supplier field to that PO's supplier (same lock-on-pick pattern M12's own supplier picker already uses).
- Pre-fills one line per outstanding PO line — item name shown read-only, quantity ordered shown read-only (the *remaining* amount, not necessarily the PO line's original quantity, if an earlier partial delivery already covered part of it), quantity received defaulting to that same figure and freely editable, condition defaulting to `ok`.
- An extra line can still be added by hand for anything that arrived outside the PO (free text, exactly today's behavior) — it just doesn't post against any PO line or, if it references no real item, into inventory either.

Leaving the picker on "no purchase order" behaves exactly as the screen has since M2.

## Data model

Additions to existing types:

```ts
// ReceivingRecord (M2) gains:
purchaseOrderId: string | null   // null = not linked, exactly today's behavior

// ReceivingItem (M2) gains:
itemId: string | null   // links to items/{id}; set automatically for a PO-matched
                         // line, settable by hand for an unmatched one too

// PurchaseOrderLine (M14) gains:
qtyReceivedSoFar: number   // server-maintained only, via onReceivingRecordCreated.
                            // Starts at 0 — M14's own order-creation code needs a
                            // one-line touch to initialize it on every new line.
```

## Logic

**`onReceivingRecordCreated` (Cloud Function, Firestore trigger on `receivingRecords/{id}`):**
1. For every line on the new record with `itemId` set, create an `InventoryMovement` — `delta: +qtyReceived`, `reason: 'receiving'`, `sourceCollection: 'receivingRecords'`, `sourceId` the record's own id. This alone makes the delivery show up in that item's stock, whether or not a PO is involved at all.
2. If `purchaseOrderId` is set, in a single transaction: read that PO, and for each received line whose `itemId` matches one of the PO's own line items, add the received quantity to that line's `qtyReceivedSoFar` (a PO with two lines for the same item — a data-entry mistake M14's own create form doesn't currently prevent — fills the first matching line's remaining capacity before spilling into the next). Recompute status: `received` if every line's `qtyReceivedSoFar` has reached its `qtyOrdered`, otherwise `partially_received` if any line has received anything at all. Write both the updated lines and the new status back in the same transaction.

**Inventory posts for any linked item regardless of PO match.** A receiving line can have a real `itemId` without `purchaseOrderId` being set at all (someone just picked the item from a dropdown on an unplanned delivery) — it still posts into inventory. PO-line closure is the part that specifically needs a PO link; stock arriving does not.

**Over-receiving isn't blocked, just visible.** If `qtyReceived` on a PO-linked line exceeds what was actually still outstanding, the existing `discrepancyNoted` mechanism (`condition !== 'ok' || qtyOrdered !== qtyReceived`) already surfaces it — no new validation is added here, the same honest "record what happened, flag what doesn't match, let a human decide" posture this codebase has used since M1's duplicate-reading detection.

## Security rules — the shape

```
// purchaseOrders/{id}'s M14 update rule gains one more condition on the
// manual path: a client update may only move status to 'sent',
// 'confirmed', or 'cancelled' — 'partially_received' and 'received' are
// no longer client-reachable at all, only written by the Admin SDK trigger
// above (which bypasses these rules the same way every other
// Cloud-Function-only write in this codebase already does).
allow update: if isManager()
               && sameBranch(resource.data.branchId)
               && isValidPoStatusTransition(resource.data.status, request.resource.data.status)
               && (request.resource.data.status in ['draft', 'sent', 'confirmed', 'cancelled'])
               && ( /* draft-editing or status-only clause, unchanged from M14 */ );
```

`receivingRecords`' existing create rule needs no change — `purchaseOrderId` and each line's `itemId` are just more optional fields on a shape the rule already allows a station account or manager to create.

## Acceptance criteria

**Receiving against a PO**
- [ ] Only POs in `sent`, `confirmed`, or `partially_received` appear in the picker
- [ ] Picking a PO locks the supplier field and pre-fills lines with read-only item and quantity-ordered
- [ ] Quantity received stays freely editable on a PO-linked line
- [ ] A receiving record with no PO picked behaves exactly as before M15

**Inventory posting**
- [ ] A receiving line with a real item posts an `InventoryMovement` with `reason: 'receiving'`, regardless of whether a PO is linked
- [ ] A receiving line with no item linked posts nothing, exactly as before M15

**PO closure**
- [ ] Receiving the full outstanding quantity on every line moves the PO to `received`
- [ ] Receiving only some of a PO's outstanding quantity moves it to `partially_received`
- [ ] A second, later receiving record against the same PO correctly adds to `qtyReceivedSoFar` rather than overwriting it
- [ ] A client (including a manager) attempting to set a PO's status to `partially_received` or `received` directly is rejected by the rules
- [ ] The PO detail screen's manual status controls no longer offer "mark partially received" or "mark received" — only `sent`, `confirmed`, and cancel remain manual

**End-to-end**
- [ ] Create a PO, send it, receive against it twice (a partial delivery, then the rest) — status reads `partially_received` after the first, `received` after the second, and the item's `qtyOnHand` reflects both deliveries correctly
