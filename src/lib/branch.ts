// M0 is single-branch, but every read here is already branch-scoped so
// multi-branch never becomes a rewrite — see docs/01-ARCHITECTURE.md rule 1.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where, limit } from 'firebase/firestore'
import { branchesCol } from './firebase'
import type { Branch } from './types'

export type ActiveBranch = { branchId: string; branch: Branch }

let cached: ActiveBranch | null = null
const listeners = new Set<(b: ActiveBranch | null) => void>()
let unsubscribe: (() => void) | null = null

function ensureListening() {
  if (unsubscribe) return
  const q = query(branchesCol, where('status', '==', 'active'), limit(1))
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      const d = snap.docs[0]
      cached = d ? { branchId: d.id, branch: d.data() } : null
      listeners.forEach((l) => l(cached))
    },
    () => {
      // A permission-denied (e.g. this fired before sign-in resolved) kills
      // the stream for good — Firestore won't retry it on its own. Clearing
      // the guard lets the next mount start a fresh, hopefully-authenticated
      // listener instead of leaving the app stuck on "resolving…" forever.
      unsubscribe = null
    },
  )
}

/** The one trading branch. When a second branch exists this becomes a
 *  manager-selectable value; the call sites (params, business day, write
 *  helper) do not need to change. */
export function useActiveBranch(): ActiveBranch | null {
  const [state, setState] = useState<ActiveBranch | null>(cached)

  useEffect(() => {
    ensureListening()
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  return state
}
