// Pure logic for temperature readings and excursions —
// docs/04-M1-COLDCHAIN.md "Logic". Kept free of Firestore/React so the
// rules (in/out of range, duplicate, auto-quarantine) are easy to read and
// to get right once. Slot scheduling (due/overdue/missed) moved to
// lib/slots.ts once M2 needed the same logic for checklist runs —
// re-exported here so existing M1 call sites don't need to change.
import type { EquipmentThresholds } from './types'

export type { SlotStatus, Slot } from './slots'
export { generateSlots, slotStatus, currentTargetSlot } from './slots'

/** null thresholds (or any null field inside) means unset — the reading
 *  still saves, just with withinRange: null. Never invent a target. */
export function evaluateWithinRange(valueC: number, thresholds: EquipmentThresholds | null): boolean | null {
  if (!thresholds || thresholds.minC === null || thresholds.maxC === null) return null
  return valueC >= thresholds.minC && valueC <= thresholds.maxC
}

/** Three consecutive identical-to-one-decimal readings are flagged, not
 *  blocked — the crew member may be telling the truth
 *  (docs/04-M1-COLDCHAIN.md §2, "anti-patterns to design out"). */
export function isSuspiciousDuplicateRun(previousTwoValuesC: number[], newValueC: number): boolean {
  if (previousTwoValuesC.length < 2) return false
  const round1dp = (n: number) => Math.round(n * 10) / 10
  const values = [...previousTwoValuesC, newValueC].map(round1dp)
  return values.every((v) => v === values[0])
}

/** If maxExcursionMinutes is unset, auto-quarantine must NOT fire — surface
 *  it to the Shift Leader instead (docs/05-PARAMETERS.md, docs/04-M1-COLDCHAIN.md §Logic). */
export function shouldAutoQuarantine(durationMinutes: number, maxExcursionMinutes: number | null): boolean {
  if (maxExcursionMinutes === null) return false
  return durationMinutes >= maxExcursionMinutes
}

export const EMPTY_FIRST_CHECKS = {
  doorOpen: false,
  overloaded: false,
  iceBuildup: false,
  defrostCycle: false,
  powerInterruption: false,
  gasketDamaged: false,
  setpointChanged: false,
  nothingFound: false,
  detail: '',
}
