// docs/12-M7-DOCUMENT-CONTROL.md — versioning (manager-configured reference
// data, its own write path, same reasoning as lib/equipment.ts and
// lib/params.ts's setParameter) and read-and-acknowledge (an operational
// event, goes through useWriteOperational() as usual).
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, auditLogCol, documentsCol, storage } from '@/lib/firebase'
import { newDocId, useWriteOperational } from '@/lib/write'
import { getDeviceId } from '@/lib/deviceId'
import type { DocumentCategory, DocumentRecord } from '@/lib/types'

export function useDocumentActions() {
  const { write } = useWriteOperational()

  /** Uploads the file, then writes the new version and (if superseding)
   *  flips the prior version's `active` to false — in one batch, same
   *  atomicity setParameter() uses for its own close-old/open-new pattern
   *  (docs/12-M7-DOCUMENT-CONTROL.md "Versioning"). */
  async function uploadVersion(input: {
    branchId: string
    code: string
    title: string
    category: DocumentCategory
    branchApplicability: string[] | null
    file: File
    existingActive: (DocumentRecord & { id: string }) | null
    actorId: string
    actorName: string
  }): Promise<string> {
    const docId = newDocId('documents')
    const fileRef = `branches/${input.branchId}/documents/${docId}.pdf`
    await uploadBytes(storageRef(storage, fileRef), input.file)

    const version = (input.existingActive?.version ?? 0) + 1
    const batch = writeBatch(db)
    const newRef = doc(documentsCol, docId)
    batch.set(newRef, {
      branchId: input.branchId,
      branchApplicability: input.branchApplicability,
      code: input.code,
      title: input.title,
      category: input.category,
      version,
      active: true,
      fileRef,
      fileSizeBytes: input.file.size,
      supersedesId: input.existingActive?.id ?? null,
      createdBy: input.actorName,
      createdAt: serverTimestamp(),
    })
    if (input.existingActive) {
      batch.update(doc(documentsCol, input.existingActive.id), { active: false })
    }
    await batch.commit()

    await writeBatch(db)
      .set(doc(auditLogCol), {
        entity: 'documents',
        entityId: docId,
        action: 'create',
        before: input.existingActive ? { active: true, version: input.existingActive.version } : null,
        after: { active: true, version },
        actorId: input.actorId,
        actorName: input.actorName,
        at: serverTimestamp(),
        deviceId: getDeviceId(),
        branchId: input.branchId,
      })
      .commit()

    return docId
  }

  async function acknowledge(documentId: string, documentCode: string): Promise<string> {
    return write('documentAcknowledgments', { documentId, documentCode })
  }

  async function getViewUrl(fileRef: string): Promise<string> {
    return getDownloadURL(storageRef(storage, fileRef))
  }

  return { uploadVersion, acknowledge, getViewUrl }
}
