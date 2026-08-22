// Staff PIN — attribution, not authorisation. Verification is entirely
// local (bcrypt against an IndexedDB cache) so it works with wifi off.
// See docs/01-ARCHITECTURE.md for the accepted trade-off this implies.
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import bcrypt from 'bcryptjs'
import { addDoc, query, serverTimestamp, where, getDocs } from 'firebase/firestore'
import { auditLogCol, usersCol } from './firebase'
import { getDeviceId } from './deviceId'
import { useParam } from './params'
import type { RoleCode } from './types'

const DB_NAME = 'g7-pin-cache'
const DB_VERSION = 1
const STAFF_STORE = 'staff'
const META_STORE = 'meta'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // "at least daily" — see M0 spec §5

export type CachedStaff = {
  userId: string
  displayName: string
  roles: RoleCode[]
  pinHash: string
  branchIds: string[]
}

let dbPromise: Promise<IDBPDatabase> | null = null
function cacheDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STAFF_STORE, { keyPath: 'userId' })
        db.createObjectStore(META_STORE)
      },
    })
  }
  return dbPromise
}

/** Pull active users for this branch from Firestore into the local PIN
 *  cache. Requires connectivity; call on app start (if online) and on
 *  reconnect. Never blocks PIN entry — verifyPin only reads the cache. */
export async function refreshPinCache(branchId: string): Promise<void> {
  const snap = await getDocs(
    query(usersCol, where('branchIds', 'array-contains', branchId), where('status', '==', 'active')),
  )
  const db = await cacheDb()
  const tx = db.transaction([STAFF_STORE, META_STORE], 'readwrite')
  await tx.objectStore(STAFF_STORE).clear()
  for (const doc of snap.docs) {
    const u = doc.data()
    const staff: CachedStaff = {
      userId: doc.id,
      displayName: u.displayName,
      roles: u.roles,
      pinHash: u.pinHash,
      branchIds: u.branchIds,
    }
    await tx.objectStore(STAFF_STORE).put(staff)
  }
  await tx.objectStore(META_STORE).put(Date.now(), 'lastSyncedAt')
  await tx.done
}

export async function shouldRefreshPinCache(): Promise<boolean> {
  const db = await cacheDb()
  const lastSyncedAt = (await db.get(META_STORE, 'lastSyncedAt')) as number | undefined
  if (!lastSyncedAt) return true
  return Date.now() - lastSyncedAt > REFRESH_INTERVAL_MS
}

async function getCachedStaff(): Promise<CachedStaff[]> {
  const db = await cacheDb()
  return db.getAll(STAFF_STORE)
}

async function recordFailedPin(): Promise<void> {
  // No actor exists yet, so this bypasses writeOperational deliberately —
  // it is the one write in the app that is inherently actor-less.
  try {
    await addDoc(auditLogCol, {
      entity: 'pinAttempt',
      entityId: 'failed',
      action: 'create',
      before: null,
      after: null,
      actorId: 'unknown',
      actorName: 'Unknown (failed PIN)',
      at: serverTimestamp(),
      deviceId: getDeviceId(),
      branchId: import.meta.env.VITE_STATION_BRANCH_ID ?? 'unknown',
    })
  } catch {
    // Offline: Firestore queues the write; nothing further to do here.
  }
}

/** Entirely local — never calls the network. Returns the matching cached
 *  staff record, or null and logs a failed attempt. */
export async function verifyPin(pin: string): Promise<CachedStaff | null> {
  const staff = await getCachedStaff()
  for (const s of staff) {
    if (bcrypt.compareSync(pin, s.pinHash)) return s
  }
  await recordFailedPin()
  return null
}

// ---- actor session (module-level store, shared across the app) ----

type ActorSession = { actor: CachedStaff; lastActivityAt: number } | null

let session: ActorSession = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ActorSession {
  return session
}

export function setActorSession(actor: CachedStaff) {
  session = { actor, lastActivityAt: Date.now() }
  emit()
}

export function clearActorSession() {
  session = null
  emit()
}

export function touchActorSession() {
  if (session) {
    session = { ...session, lastActivityAt: Date.now() }
    // Deliberately no emit() — bumping the timestamp on every click would
    // re-render every subscriber; the timeout check below reads it lazily.
  }
}

const DEFAULT_TIMEOUT_MINUTES = 15

/** Current PIN-identified actor, with inactivity timeout. Default 15 min,
 *  overridden by the `session.pin_timeout_minutes` parameter. */
export function usePinSession() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const timeoutParam = useParam('session.pin_timeout_minutes')
  const timeoutMinutes =
    timeoutParam.isSet && typeof timeoutParam.value === 'number'
      ? timeoutParam.value
      : DEFAULT_TIMEOUT_MINUTES

  useEffect(() => {
    const id = setInterval(() => {
      if (session && Date.now() - session.lastActivityAt > timeoutMinutes * 60_000) {
        clearActorSession()
      }
    }, 15_000)
    return () => clearInterval(id)
  }, [timeoutMinutes])

  const recordActivity = useCallback(() => touchActorSession(), [])

  return {
    actor: snapshot?.actor ?? null,
    setActor: setActorSession,
    clearActor: clearActorSession,
    recordActivity,
  }
}
