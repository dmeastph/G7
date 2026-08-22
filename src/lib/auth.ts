// Two auth tiers, deliberately not symmetric — see docs/01-ARCHITECTURE.md.
// Both are plain Firebase Auth email/password; what differs is the `role`
// custom claim, which is what security rules actually check. The station
// account is just a managed account whose role happens to be 'station'.
import { useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import { auth } from './firebase'
import type { RoleCode } from './types'

export type AuthClaims = {
  role: RoleCode | null
  branchId: string | null
}

export type AuthState =
  | { mode: 'none'; user: null; claims: null; branchId: null; loading: boolean }
  | { mode: 'managed' | 'station'; user: FirebaseUser; claims: AuthClaims; branchId: string | null; loading: boolean }

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password)
}

export async function signOut() {
  await firebaseSignOut(auth)
}

/** Force a refresh of the ID token — call after a role/claim change, since
 *  claims only change on token mint, not on every request. */
export async function refreshClaims() {
  await auth.currentUser?.getIdToken(true)
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    mode: 'none',
    user: null,
    claims: null,
    branchId: null,
    loading: true,
  })

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ mode: 'none', user: null, claims: null, branchId: null, loading: false })
        return
      }
      const tokenResult = await user.getIdTokenResult()
      const role = (tokenResult.claims.role as RoleCode | undefined) ?? null
      const branchId = (tokenResult.claims.branchId as string | undefined) ?? null
      setState({
        mode: role === 'station' ? 'station' : 'managed',
        user,
        claims: { role, branchId },
        branchId,
        loading: false,
      })
    })
  }, [])

  return state
}
