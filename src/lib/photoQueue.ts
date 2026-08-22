// Storage has no built-in offline queue the way Firestore does — this is
// the equivalent for photo evidence: durable across reload, retried on
// reconnect. Never blocks the reading save itself (docs/04-M1-COLDCHAIN.md
// acceptance: "Photo attaches, compresses to under 300KB, and uploads on
// reconnect" — this is what makes the "on reconnect" part true).
import { openDB, type IDBPDatabase } from 'idb'
import { ref, uploadBytes } from 'firebase/storage'
import { storage } from './firebase'

const DB_NAME = 'g7-photo-queue'
const DB_VERSION = 1
const STORE = 'pending'

type QueuedPhoto = { id: string; storagePath: string; blob: Blob; queuedAt: number }

let dbPromise: Promise<IDBPDatabase> | null = null
function queueDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

async function attemptUpload(entry: QueuedPhoto): Promise<void> {
  try {
    await uploadBytes(ref(storage, entry.storagePath), entry.blob)
    const db = await queueDb()
    await db.delete(STORE, entry.id)
  } catch {
    // Still offline, or the upload failed — leave it queued for the next retry.
  }
}

/** Queues durably first, then makes a best-effort immediate attempt. The
 *  caller (the reading save) never awaits this — the reading's `photoRef`
 *  already points at `storagePath`, which the file will occupy once this
 *  succeeds, now or on reconnect. */
export function queuePhotoUpload(id: string, storagePath: string, blob: Blob): void {
  queueDb()
    .then((db) => db.put(STORE, { id, storagePath, blob, queuedAt: Date.now() }))
    .then(() => attemptUpload({ id, storagePath, blob, queuedAt: Date.now() }))
    .catch((err) => console.error('Failed to queue photo upload', err))
}

/** Call on reconnect (and once at app start if already online). */
export async function retryQueuedPhotoUploads(): Promise<void> {
  const db = await queueDb()
  const all = (await db.getAll(STORE)) as QueuedPhoto[]
  await Promise.all(all.map(attemptUpload))
}
