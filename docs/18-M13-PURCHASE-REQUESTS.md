# 18 — M13 · Purchase requests

**Build this after M10 and M12.** A request references real items (M10) — there's nothing sensible to request otherwise — and M14 needs an *approved* request to build a purchase order from. Suppliers (M12) are deliberately not part of this module; see below.

## Why this is a request, not straight to a purchase order

`docs/06-ROADMAP.md` puts a request-then-order split between M13 and M14 on purpose, not as busywork: the person who notices stock is low (anyone on the floor) is usually not the person authorized to actually spend money with a supplier (a manager). Splitting "what do we need" from "who do we buy it from and for how much" means the floor can flag a need the moment they see it, without waiting for whoever's free to sit down and build a full order. This is the exact same reasoning `docs/14-M9-EMPLOYEE-SELF-SERVICE.md` already uses for leave requests — anyone can ask, only a manager decides — and this module reuses that pattern directly rather than inventing a new one.

**A closer look at that existing pattern, not the vaguer one the roadmap entry originally described.** `leaveRequests`' actual rule is `allow create: if signedIn()`, `allow update: if isManager()` — any signed-in user can submit, and approval is a manager-only *update* to that same document, enforced in `firestore.rules` itself, not just hidden behind a UI button. That's the real, already-shipped precedent this module follows exactly, line for line.

**Why no supplier here, even though M12 already exists.** `docs/06-ROADMAP.md`'s own description of M14 says a purchase order is built "against a real supplier" — that choice belongs at the *ordering* step, where a manager is actually deciding who to buy from and at what price, not at the *request* step, where a requester is only flagging what's needed. Asking someone requesting six cases of ramen to also pick a supplier would either force them to guess at a decision that isn't theirs to make, or block the request entirely on a decision nobody's ready to make yet. Supplier selection is M14's job.

## What it does

1. `g7-ops` gains a `purchaseRequests` collection: who asked, for which real items and quantities, needed by when, and its approval status.
2. A **My purchase requests** screen (any signed-in user) — submit a new request against real catalogue items, see your own request history and its status.
3. A **Purchase request approvals** screen (manager-tier) — pending requests branch-wide, approve or deny, a note required to deny (same requirement `LeaveApprovalsPage` already enforces).
4. Nothing here talks to `g7-pos`, writes to inventory, or touches a supplier — this module's entire job is turning "we need more of X" into a real, approved record M14 can build from.

## Screens

### 1 · My purchase requests (`g7-ops`)

Submit: one or more lines (pick a real item from the M10 catalogue, quantity, unit — free text, e.g. "cases," since not every item has `unitOfPurchase` set yet), a needed-by date, an optional note. Below the form, the requester's own past requests with their current status (`pending` / `approved` / `denied`) and, once decided, the manager's decision note.

### 2 · Purchase request approvals (`g7-ops`, manager-tier)

Pending requests branch-wide — requester, lines, needed-by date, note. Approve or deny per request, mirroring `LeaveApprovalsPage` exactly: a note is required to deny, optional to approve.

## Data model

```ts
type PurchaseRequestLine = {
  itemId: string      // items/{id} — a real M10 item, never free text
  itemName: string    // snapshot at request time, so a later item rename doesn't rewrite history
  qty: number
  unit: string        // free text — "cases," "kg," whatever the requester means
}

type PurchaseRequest = OperationalBase & {
  userId: string
  userName: string
  lines: PurchaseRequestLine[]
  neededBy: string    // YYYY-MM-DD
  note: string
  status: 'pending' | 'approved' | 'denied'
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: Timestamp | null
  decisionNote: string
}
```

Add `PurchaseRequest` to `docs/02-DATA-MODEL.md` alongside the other M-numbered collections.

## Security rules — the shape

```
match /purchaseRequests/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn()
                 && sameBranch(request.resource.data.branchId)
                 && request.resource.data.actorId is string
                 && request.resource.data.createdAt == request.time
                 && request.resource.data.status == 'pending';
  allow update: if isManager() && sameBranch(resource.data.branchId);
  allow delete: if false;
}
```

Identical in shape to `leaveRequests`' own rule, with one addition: `status == 'pending'` is required at create time, closing off a request being submitted pre-approved by a client that simply sets the field itself — the same reasoning `WastageRecord`/`ReceivingRecord`'s `createdAt == request.time` check exists for, applied to the field that actually matters here.

## Acceptance criteria

**Submitting a request**
- [ ] A signed-in user can submit a request with at least one line, referencing a real item
- [ ] A request cannot be submitted with `status` set to anything but `pending`, even if a client tries
- [ ] The requester sees their own request immediately, with status `pending`

**Approval**
- [ ] A manager sees all pending requests branch-wide, not just their own
- [ ] Approving requires no note; denying requires one, same as `LeaveApprovalsPage`
- [ ] A cashier or station account cannot approve or deny a request, even by calling the write directly, bypassing the UI
- [ ] Once decided, a request cannot be re-decided (no client update path exists after `status` leaves `pending` — enforced the same way the rule is written, not by extra application logic)

**End-to-end**
- [ ] Submit a request for two different real items, have a manager approve one line's worth conceptually by approving the whole request (M13 approves or denies a request as a whole, not per line — a partial decision is M14's territory, when actual order lines get built)
- [ ] Deny a request with a note; the requester's own view shows that note
- [ ] A request never appears anywhere outside `g7-ops` — nothing here reaches `g7-pos` or any supplier
