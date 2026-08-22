// Every operating value in the app comes from here — never a literal in a
// component (docs/01-ARCHITECTURE.md rule 2). `value: null` is a
// deliberate, permanent "not set", never filled with a fallback.
import { useEffect, useState } from 'react'
import { doc, onSnapshot, query, serverTimestamp, where, writeBatch, addDoc } from 'firebase/firestore'
import { db, parametersCol, auditLogCol } from './firebase'
import { getDeviceId } from './deviceId'
import { useActiveBranch } from './branch'
import { useCurrentShift } from './businessDay'
import type { Parameter, ParamDataType } from './types'

export type CachedParam = Parameter & { id: string }

export type ParamResolution = {
  value: number | string | boolean | null
  isSet: boolean
  dataType: ParamDataType | null
  unit: string | null
  requiresProfessionalSignoff: boolean
  loading: boolean
}

// One live listener for every currently-effective parameter, shared across
// every useParam() call. Firestore's own offline cache is what makes this
// available with no connection.
let cache = new Map<string, CachedParam[]>()
let hasLoadedOnce = false
const cacheListeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null
let refCount = 0

function ensureListening() {
  refCount++
  if (unsubscribe) return
  const q = query(parametersCol, where('effectiveTo', '==', null))
  unsubscribe = onSnapshot(
    q,
    (snap) => {
      const next = new Map<string, CachedParam[]>()
      snap.forEach((d) => {
        const p: CachedParam = { ...d.data(), id: d.id }
        const list = next.get(p.key) ?? []
        list.push(p)
        next.set(p.key, list)
      })
      cache = next
      hasLoadedOnce = true
      cacheListeners.forEach((l) => l())
    },
    () => {
      // Same self-healing reasoning as branch.ts: a denied/dropped stream
      // never retries itself, so let the next subscriber start a fresh one.
      unsubscribe = null
    },
  )
}

function stopListening() {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0 && unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}

function resolve(key: string, branchId: string | null, shiftTemplateId: string | null): CachedParam | null {
  const candidates = cache.get(key)
  if (!candidates?.length) return null
  if (shiftTemplateId) {
    const st = candidates.find((p) => p.scope === 'shift_template' && p.scopeId === shiftTemplateId)
    if (st) return st
  }
  if (branchId) {
    const b = candidates.find((p) => p.scope === 'branch' && p.scopeId === branchId)
    if (b) return b
  }
  return candidates.find((p) => p.scope === 'global') ?? null
}

/** Resolution order: shift_template -> branch -> global. `isSet === false`
 *  must render as "not set" — use <ParamValue /> everywhere rather than
 *  reading .value directly, so that's not a rule every call site has to
 *  remember. */
export function useParam(key: string): ParamResolution {
  const activeBranch = useActiveBranch()
  const currentShift = useCurrentShift()
  const [, forceRender] = useState(0)

  useEffect(() => {
    ensureListening()
    const listener = () => forceRender((n) => n + 1)
    cacheListeners.add(listener)
    return () => {
      cacheListeners.delete(listener)
      stopListening()
    }
  }, [])

  const resolved = resolve(key, activeBranch?.branchId ?? null, currentShift?.templateId ?? null)

  if (!resolved) {
    return {
      value: null,
      isSet: false,
      dataType: null,
      unit: null,
      requiresProfessionalSignoff: false,
      loading: !hasLoadedOnce,
    }
  }
  return {
    value: resolved.value,
    isSet: resolved.value !== null,
    dataType: resolved.dataType,
    unit: resolved.unit,
    requiresProfessionalSignoff: resolved.requiresProfessionalSignoff,
    loading: false,
  }
}

/** All currently-effective parameters, for the manager admin list. */
export function useAllParams(): CachedParam[] {
  const [, forceRender] = useState(0)
  useEffect(() => {
    ensureListening()
    const listener = () => forceRender((n) => n + 1)
    cacheListeners.add(listener)
    return () => {
      cacheListeners.delete(listener)
      stopListening()
    }
  }, [])
  return Array.from(cache.values()).flat()
}

export class ParamEditError extends Error {}

/** Changing a parameter never overwrites it: the old document is closed
 *  (effectiveTo set) and a new one takes over. Historical values stay
 *  queryable — see docs/02-DATA-MODEL.md. */
export async function setParameter(opts: {
  key: string
  scope: Parameter['scope']
  scopeId: string | null
  newValue: Parameter['value']
  reason: string
  actorId: string
  actorName: string
  branchId: string
  confirmedSignoff?: boolean
}): Promise<void> {
  const existing = cache.get(opts.key)?.find((p) => p.scope === opts.scope && p.scopeId === opts.scopeId)
  if (!existing) {
    throw new ParamEditError(`No active parameter found for ${opts.key} at scope ${opts.scope}`)
  }
  if (existing.requiresProfessionalSignoff && !opts.confirmedSignoff) {
    throw new ParamEditError('This value requires professional sign-off confirmation before it can change.')
  }
  if (!opts.reason.trim()) {
    throw new ParamEditError('A reason is required to change a parameter.')
  }
  if (typeof opts.newValue === 'number') {
    if (existing.minAllowed !== null && opts.newValue < existing.minAllowed) {
      throw new ParamEditError(`Value below minimum allowed (${existing.minAllowed})`)
    }
    if (existing.maxAllowed !== null && opts.newValue > existing.maxAllowed) {
      throw new ParamEditError(`Value above maximum allowed (${existing.maxAllowed})`)
    }
  }

  const batch = writeBatch(db)
  const oldRef = doc(parametersCol, existing.id)
  batch.update(oldRef, { effectiveTo: serverTimestamp() })

  const newRef = doc(parametersCol)
  const { id: _existingId, ...existingData } = existing
  batch.set(newRef, {
    ...existingData,
    value: opts.newValue,
    effectiveFrom: serverTimestamp(),
    effectiveTo: null,
    changedBy: opts.actorId,
    changedAt: serverTimestamp(),
    reason: opts.reason,
  })

  await batch.commit()

  await addDoc(auditLogCol, {
    entity: 'parameter',
    entityId: existing.id,
    action: 'param_change',
    before: { value: existing.value },
    after: { value: opts.newValue },
    actorId: opts.actorId,
    actorName: opts.actorName,
    at: serverTimestamp(),
    deviceId: getDeviceId(),
    branchId: opts.branchId,
  })
}
