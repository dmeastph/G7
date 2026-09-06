# 17 — M12 · Suppliers

**Build this after M11.** M13 (purchase requests) and M14 (purchase orders) both need a real supplier to reference — this is the last piece of master data the rest of the procurement chain builds on.

## Why now, and why it looks like M10/M11

Two places in this codebase already have a supplier-shaped hole waiting for this module: `ReceivingRecord.supplier` (M2) has always been a free-text string typed fresh on every delivery, and `ItemDoc.defaultSupplierId` (M10) has sat `null` since the day it was added, with the Catalogue screen's own edit dialog saying outright *"Default supplier isn't available yet — that arrives with the suppliers module (M12)."* This module is the one that keeps that promise.

The shape of the fix is the same one M11 just used for wastage: add a real, optional reference alongside the existing free-text field, never replace it outright. A manager who receives from the same ten suppliers every week gets to pick a real one from a list; a one-off delivery from someone not worth adding to master data yet still gets logged by typing a name, exactly as it does today. Nothing about today's receiving behavior breaks the day this ships.

**Why supplier records are manager-only to create, unlike wastage's item picker being open to everyone:** an item in M10 arrives automatically from `g7-pos`'s own catalogue — there's no risk of duplicate or junk items piling up from casual use. A supplier typed in by whoever happens to be receiving a delivery is a different risk: "Acme Produce", "ACME Produce Co.", and "acme" become three rows for one real supplier within a month if anyone can create one. Real master data stays governed by the same tier that already owns `items`' operational fields and the catalogue sync — a station account can still log a delivery from a supplier not yet in the list, by falling back to the free-text field, same as it can today.

## What it does

1. `g7-ops` gains a `suppliers` collection — name, category, contact info, certifications, payment terms, active status.
2. A new **Suppliers** screen (manager-tier) lists, creates, and edits supplier records. No delete — a supplier that stops being used is set `active: false`, the same soft-delete posture `ItemDoc.active` and `User.status` already use elsewhere in this codebase, so historical receiving records and purchase orders (M14) keep a valid reference to who they were actually from.
3. `ReceivingLogPage` (M2) gains an optional supplier picker, same pattern as M11's wastage item picker: pick a real supplier and `supplierId` is set alongside the existing free-text `supplier` field (locked to that supplier's name); leave it unpicked and behavior is exactly what it is today.
4. The Catalogue screen's item edit dialog (M10) gains a real supplier picker for `defaultSupplierId`, replacing the "not available yet" placeholder text that's been sitting there since M10 shipped.

## Screens

### 1 · Suppliers (`g7-ops`, manager-tier)

A list of suppliers (name, category, active/inactive) with a create/edit form: name, category, contact name, contact phone, contact email, certifications (free-text tags — a supplier might list "Halal", "FDA-registered," or nothing at all; no fixed taxonomy imposed on day one), payment terms (free text — "Net 30", "COD," whatever the actual arrangement is), and an active toggle. Inactive suppliers stay visible here (so a manager can reactivate one) but drop out of the picker on Receiving and Catalogue.

### 2 · Receiving (`g7-ops`, existing screen from M2, extended)

Adds a supplier picker above the existing free-text supplier field, mirroring exactly how M11 added an item picker above `WastageLogPage`'s free-text item name: pick a real supplier and the free-text field locks to that supplier's name (so `ReceivingRecord.supplier` stays populated and human-readable regardless of whether `supplierId` is set); leave the picker on "type a name instead" and nothing about today's screen changes.

### 3 · Catalogue item dialog (`g7-ops`, existing dialog from M10, extended)

`ItemOperationalFieldsDialog` gains a supplier picker (active suppliers only) for `defaultSupplierId`, alongside the existing reorder point and unit of purchase fields. This is the one place `defaultSupplierId` is ever set — nothing else writes it.

## Data model

```ts
// New — the one real supplier list this whole codebase references.
// No delete: a supplier that stops being used is deactivated, never removed,
// so anything that already points at it (a receiving record, a future PO)
// keeps a valid reference.
type Supplier = {
  name: string
  category: string             // free text, same posture as ItemDoc.category — no fixed taxonomy imposed
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  certifications: string[]     // free-text tags, e.g. ["Halal", "FDA-registered"] — empty array if none on file
  paymentTerms: string | null  // free text, e.g. "Net 30", "COD"
  active: boolean
  createdAt: Timestamp
}
```

Additions to existing types:

```ts
// ReceivingRecord (docs/02-DATA-MODEL.md, M2) gains:
supplierId: string | null   // null = free-text supplier only, exactly today's behavior

// ItemDoc (docs/15-M10-ITEM-MASTER.md) — defaultSupplierId already exists,
// null since the field was added. This module is simply the first thing
// that ever sets it to a real value.
```

## Security rules — the shape

```
match /suppliers/{id} {
  allow read: if signedIn();
  allow create, update: if isManager();
  allow delete: if false;   // deactivate, never delete — see Why, above
}
```

`receivingRecords`' existing create rule needs no change — `supplierId` is just one more optional field on a document shape the rule already allows a station account or manager to create; the rule doesn't enumerate every field, so an additive one needs no new clause. `items/{id}`'s existing M10 update rule (`hasOnly(['reorderPoint', 'defaultSupplierId', 'unitOfPurchase'])`) needs no change either — `defaultSupplierId` was already in that allow-list from the day M10 shipped, just unused until now. Two modules in a row now where an earlier design held up without modification the moment a real second feature needed it.

## Acceptance criteria

**Suppliers screen**
- [ ] A manager can create a supplier with just a name — every other field is optional
- [ ] A manager can edit any field on an existing supplier, including toggling `active`
- [ ] A cashier or station account cannot create or edit a supplier
- [ ] No delete control exists anywhere in the UI for a supplier record
- [ ] An inactive supplier still appears in the Suppliers list itself, but not in the Receiving or Catalogue pickers

**Receiving integration**
- [ ] Logging a delivery with no supplier picked behaves exactly as before M12 — free-text `supplier`, `supplierId` left null
- [ ] Picking a real supplier sets both `supplierId` and locks `supplier` to that supplier's current name
- [ ] An existing (pre-M12) receiving record is unaffected — its free-text `supplier` is untouched, `supplierId` is simply absent

**Catalogue integration**
- [ ] The item edit dialog's supplier picker only lists active suppliers
- [ ] Setting `defaultSupplierId` from the dialog persists correctly and survives the next catalogue sync (M10's sync never touches operational fields)
- [ ] The dialog's old "not available yet" placeholder text is gone

**End-to-end**
- [ ] Create a supplier, set it as an item's default supplier from the Catalogue screen, then log a receiving delivery picking that same supplier — both references point at the same `suppliers/{id}` document
- [ ] Deactivate a supplier already set as an item's `defaultSupplierId` — the item keeps the reference (nothing auto-clears it), but the supplier no longer appears as a pickable option for a *different* item's default supplier or a new receiving record
