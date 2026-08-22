// Firestore queues writes itself — never build a second sync queue
// (docs/01-ARCHITECTURE.md). What Firestore does *not* expose is an exact
// "how many writes are still queued" count, so this is a deliberate
// approximation: increment on every commit, reset to 0 once
// waitForPendingWrites() resolves while online. Good enough for a banner,
// not a source of truth.
import { useEffect, useState } from 'react'
import { waitForPendingWrites } from 'firebase/firestore'
import { db } from './firebase'

const STORAGE_KEY = 'g7.pendingWriteCount'

function readCount(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? Number(raw) || 0 : 0
}

function persistCount(n: number) {
  localStorage.setItem(STORAGE_KEY, String(Math.max(0, n)))
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}

/** Call right before every writeBatch().commit() on an operational write. */
export function notePendingWrite() {
  persistCount(readCount() + 1)
  emit()
}

async function reconcile() {
  if (!navigator.onLine) return
  try {
    await waitForPendingWrites(db)
    persistCount(0)
    emit()
  } catch {
    // Still offline, or the backend hasn't acked yet — leave the count.
  }
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      reconcile()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}

export function usePendingWriteCount(): number {
  const [count, setCount] = useState(readCount())
  useEffect(() => {
    const listener = () => setCount(readCount())
    listeners.add(listener)
    const interval = setInterval(() => {
      if (navigator.onLine) reconcile()
    }, 15_000)
    return () => {
      listeners.delete(listener)
      clearInterval(interval)
    }
  }, [])
  return count
}
