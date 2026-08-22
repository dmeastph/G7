// Certification level logic — docs/08-M3-TIME-ROSTER-CERTIFICATION.md
// "the control that matters". An expired certification does not count as
// held; L1-L5 is a ladder (holding L4 satisfies an L3 requirement),
// Module F is its own axis, not part of the ladder.
import type { Certification, RoleCode } from './types'

export const CERT_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const
export type CertLevel = (typeof CERT_LEVELS)[number]
export const MODULE_F = 'module_f'

export function isCertificationActive(cert: Certification | undefined, now: Date): boolean {
  if (!cert) return false
  if (cert.expiresAt === null) return true
  return cert.expiresAt.toDate() > now
}

/** 0 if nothing active, else the highest L-level rank held (L5 = 5). */
export function highestActiveLevel(certifications: Record<string, Certification>, now: Date): number {
  let highest = 0
  for (let i = 0; i < CERT_LEVELS.length; i++) {
    if (isCertificationActive(certifications[CERT_LEVELS[i]], now)) highest = i + 1
  }
  return highest
}

export function meetsLevel(certifications: Record<string, Certification>, minLevel: CertLevel, now: Date): boolean {
  return highestActiveLevel(certifications, now) >= CERT_LEVELS.indexOf(minLevel) + 1
}

export function hasModuleF(certifications: Record<string, Certification>, now: Date): boolean {
  return isCertificationActive(certifications[MODULE_F], now)
}

type RoleRequirement = { minLevel?: CertLevel; moduleF?: boolean }

/** Fixed by the manual, not configurable per branch — see
 *  docs/08-M3-TIME-ROSTER-CERTIFICATION.md "Certification check at
 *  assignment". */
export const ROLE_REQUIREMENTS: Partial<Record<RoleCode, RoleRequirement>> = {
  cashier: { minLevel: 'L3' },
  shift_leader: { minLevel: 'L4' },
  kitchen_staff: { moduleF: true },
}

export function meetsRoleRequirement(
  certifications: Record<string, Certification>,
  role: RoleCode,
  now: Date,
): { ok: boolean; reason: string | null } {
  const req = ROLE_REQUIREMENTS[role]
  if (!req) return { ok: true, reason: null }
  if (req.minLevel && !meetsLevel(certifications, req.minLevel, now)) {
    return { ok: false, reason: `${role} requires ${req.minLevel} certification or above.` }
  }
  if (req.moduleF && !hasModuleF(certifications, now)) {
    return { ok: false, reason: `${role} requires Module F food certification.` }
  }
  return { ok: true, reason: null }
}

export type CoverageAssignee = { role: RoleCode; certifications: Record<string, Certification> }

export type CoverageTests = {
  l4Present: boolean
  l3OnDrawer: boolean
  moduleFPresent: boolean
}

/** The three cover tests from docs/08-M3-TIME-ROSTER-CERTIFICATION.md §4.
 *  "L3 on the drawer" fails if nobody is assigned cashier at all — an
 *  unstaffed till isn't a covered one. */
export function computeCoverageTests(assignees: CoverageAssignee[], now: Date): CoverageTests {
  const l4Present = assignees.some((a) => meetsLevel(a.certifications, 'L4', now))
  const cashiers = assignees.filter((a) => a.role === 'cashier')
  const l3OnDrawer = cashiers.length > 0 && cashiers.every((a) => meetsLevel(a.certifications, 'L3', now))
  const moduleFPresent = assignees.some((a) => hasModuleF(a.certifications, now))
  return { l4Present, l3OnDrawer, moduleFPresent }
}
