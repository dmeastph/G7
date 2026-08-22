# 12 — M7 · Document control

**Build this eighth.** Outlined in `docs/06-ROADMAP.md`; this is the full spec, written before building it, per that roadmap's own rule.

## Why this one next

M0-M6 gave the store instruments for what happens on the floor. M7 is about the manual itself — the thing every other module already cites (`equipment.chiller_target_max_c` traces to Appendix G, the setpoint warning quotes Manual Module I). Paper twin G7-DOC-02 exists because "everyone was told" is not the same as "everyone can be shown to have read the current version," and the gap between those two is exactly where an inspection or a dispute goes badly.

**M7 must work with M0-M6 present, not couple further forward.** No dashboard, no digest.

## What it does

1. Manual and SOP versions — a new version supersedes the old one; the old one stays readable, just no longer active
2. Read-and-acknowledge — a staff member opens the current version and explicitly acknowledges it
3. Who has acknowledged what — a compliance matrix, same shape as M3's certification register
4. Branch applicability — a document can apply to all branches or to specific ones, ready for the day there's more than one

## The one new piece of infrastructure this needs

Every prior module's file evidence is a photo — compressed client-side, capped at 5MB, `image/.*` only (`storage.rules`, wired in M0). A manual is a PDF, not a photo, and a manager uploads it from the back office with a connection, not from the shop floor offline — this is the same category as roster changes or parameter changes in the offline table (`docs/01-ARCHITECTURE.md`: "Needs connection"), not temperature readings or cash counts. `storage.rules` gets a second, path-scoped block for `branches/{branchId}/documents/**`: manager-only write, `application/pdf` only, capped at 10MB. The existing photo-evidence paths and their `image/.*` restriction are untouched.

**This system does not render PDFs.** "View document" opens the file's Storage download URL in a new browser tab — the device's own PDF viewer does the rest. No in-app viewer, no annotation, no OCR.

## Data model additions

### `documents/{id}`
```ts
{
  branchId: string,                        // the branch that manages this record
  branchApplicability: string[] | null,     // null = all branches; otherwise specific branchIds
  code: string,                             // stable across versions — 'SOP-COLDCHAIN-01'
  title: string,
  category: 'manual' | 'sop' | 'policy' | 'form' | 'other',
  version: number,
  active: boolean,                          // exactly one active version per code
  fileRef: string,                          // Storage path
  fileSizeBytes: number,
  supersedesId: string | null,
  createdBy: string, createdAt: Timestamp,
}
```
Not `OperationalBase` — same reasoning as `checklistTemplates` and `equipment`: this is manager-configured reference data, not a floor event. **A new version is a new document**, exactly like `checklistTemplates`' own versioning — uploading v2 writes a new `documents` doc with `version: 2, supersedesId: <v1 id>`, and in the same batch flips the v1 doc's `active` to `false`. The old version is never deleted or hidden; it's just no longer the one staff are asked to acknowledge.

### `documentAcknowledgments/{id}`
```ts
OperationalBase & {
  documentId: string,   // the specific version acknowledged
  documentCode: string, // denormalized for per-code queries
}
```
`actorId`/`actorName` (from `OperationalBase`) already carry who acknowledged — no separate field duplicating that. Append-only: acknowledging a new version is a new record, never an edit of the old one. A person can acknowledge the same version only once in practice (the UI hides the button once a record exists), but nothing enforces that at the rules level — a duplicate acknowledgment is harmless, not a correctness problem worth a transaction over.

## Screens

### 1 · Documents
Active documents for the branch (one row per `code`, its current version), title, category, version, whether the current actor has acknowledged it. Manager view adds "Upload new version."

### 2 · Document detail
Title, category, version, "View document" (opens the Storage download URL in a new tab). "Acknowledge" if the current actor hasn't yet for this version; once acknowledged, shows who and when, read-only. Version history: prior versions for this `code`, each still openable.

### 3 · Upload version (manager)
Code (existing, to supersede — or new), title, category, branch applicability, file picker (PDF only). Submitting uploads to Storage, then writes the new `documents` doc and flips the superseded version's `active` to `false` in one batch.

### 4 · Acknowledgment register (manager)
Matrix — staff down the rows, active documents across the columns, acknowledged/not per cell. Same shape as `CertificationRegisterPage`.

## Security rules — the shape

```
match /documents/{id} {
  allow read: if signedIn() && (resource == null || sameBranch(resource.data.branchId));
  allow create, update: if isManager() && sameBranch(request.resource.data.branchId);
  allow delete: if false;
}

match /documentAcknowledgments/{id} {
  allow read: if signedIn() && sameBranch(resource.data.branchId);
  allow create: if signedIn()
                 && sameBranch(request.resource.data.branchId)
                 && request.resource.data.actorId is string
                 && request.resource.data.createdAt == request.time;
  allow update, delete: if false;
}
```

## Acceptance criteria

**Versioning**
- [ ] Uploading a new version for an existing `code` creates a new document and sets the prior version's `active` to `false`, in one batch
- [ ] The prior version remains readable and openable — never deleted, never hidden from version history
- [ ] Exactly one version per `code` has `active: true` at any time
- [ ] A crew account cannot create or update a `documents` record — rules refuse it even if the UI is bypassed

**Acknowledgment**
- [ ] Acknowledging writes a `documentAcknowledgments` record with the five `OperationalBase` stamps and an `auditLog` entry
- [ ] The detail screen shows "Acknowledge" only when no acknowledgment exists yet for that actor and that document version
- [ ] Acknowledging a superseded version does not count as acknowledging the current one — the register looks at the active version's own acknowledgments only

**Register**
- [ ] The register shows every active user against every active document, correctly marking acknowledged vs. not

**Storage**
- [ ] A non-PDF upload to the documents path is refused by Storage rules
- [ ] A non-manager upload to the documents path is refused by Storage rules
- [ ] "View document" never renders the PDF in-app — it opens the Storage URL directly

**Audit**
- [ ] Every acknowledgment write produces an `auditLog` entry
- [ ] No delete path exists on either collection
