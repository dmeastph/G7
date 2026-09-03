// Loads branch 001, roles, shift templates, the nine launch staff with
// placeholder PINs, and every parameter from docs/05-PARAMETERS.md.
// Run against the emulator by default; see RUNBOOK.md to target a real
// project. Re-run is safe for branch/roles/templates/params (idempotent,
// keyed writes) but SKIPS seeding users if any already exist, since users
// are operational identities you don't want silently reset.
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (usingEmulator) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-g7-ops' })
} else {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  initializeApp({ credential: keyPath ? cert(JSON.parse(readFileSync(keyPath, 'utf8'))) : applicationDefault() })
}

const db = getFirestore()
const now = Timestamp.now()

async function seedBranch() {
  await db.collection('branches').doc('001').set({
    code: '001',
    name: 'Imus',
    operatingMode: '24_7',
    // Not applicable at 24/7 in the trading-hours sense (G7_WORK_ORDER_FINAL_1.md
    // Decision 2) — the store never actually opens or closes. Both fields stay
    // required by the Branch type (src/lib/types.ts) because ensureBusinessDay
    // (src/lib/businessDay.ts) still computes opensAt from openTime
    // unconditionally, even in '24_7' mode; closeTime is unused in that mode
    // (only the non-24_7 branch of its ternary reads it) but kept aligned to
    // the same boundary rather than left at the stale 06:00–24:00 pair.
    // Neutralised to the new cutoff, not removed.
    openTime: '07:00',
    closeTime: '07:00',
    businessDayCutoff: '07:00',
    timezone: 'Asia/Manila',
    address: 'Imus, Cavite, Philippines',
    status: 'active',
  })
  console.log('✓ branch 001')
}

const ROLES: Array<{ code: string; name: string; level: number; permissions: string[] }> = [
  { code: 'owner', name: 'Owner', level: 100, permissions: ['*'] },
  { code: 'ops_head', name: 'Operations Head', level: 90, permissions: ['param.edit', 'cash.approve_void', 'stock.release_quarantine', 'equipment.manage'] },
  { code: 'store_manager', name: 'Store Manager', level: 80, permissions: ['param.edit', 'cash.approve_void', 'stock.release_quarantine', 'equipment.manage'] },
  { code: 'shift_leader', name: 'Shift Leader', level: 50, permissions: ['cash.approve_void'] },
  { code: 'cashier', name: 'Cashier', level: 20, permissions: [] },
  { code: 'kitchen_staff', name: 'Kitchen Staff', level: 20, permissions: [] },
  { code: 'store_staff', name: 'Store Staff', level: 10, permissions: [] },
  { code: 'auditor', name: 'Auditor', level: 60, permissions: [] },
  { code: 'trainer', name: 'Trainer', level: 60, permissions: [] },
  { code: 'technician', name: 'Technician', level: 30, permissions: [] },
]

async function seedRoles() {
  const batch = db.batch()
  for (const r of ROLES) {
    batch.set(db.collection('roles').doc(r.code), { name: r.name, permissions: r.permissions, level: r.level })
  }
  await batch.commit()
  console.log(`✓ ${ROLES.length} roles`)
}

// Real roster (G7_WORK_ORDER_FINAL_1.md, 2026-09-02) — 12 staff on three
// fixed shifts, replacing the earlier placeholder that assumed a 9-staff,
// two-shift 06:00–24:00 window. G crosses midnight (endTime <= startTime),
// which ensureShiftInstances (src/lib/businessDay.ts) already handles —
// see that function's own comment. Headcount is "assigned" for max,
// "minimum on duty" for min, both from the work order's roster table; the
// Store Manager's own shift-by-shift presence (M Mon–Thu, A Fri–Sat) is
// why max exceeds the base assigned count on M and A.
const SHIFT_TEMPLATES = [
  { name: 'Morning', startTime: '06:00', endTime: '15:00', targetHeadcount: { min: 2, max: 3 } },
  { name: 'Afternoon', startTime: '14:00', endTime: '23:00', targetHeadcount: { min: 4, max: 6 } },
  { name: 'Graveyard', startTime: '22:00', endTime: '07:00', targetHeadcount: { min: 3, max: 4 } },
]

async function seedShiftTemplates() {
  const existing = await db.collection('shiftTemplates').where('branchId', '==', '001').limit(1).get()
  if (!existing.empty) {
    console.log('· shiftTemplates already present, skipping')
    return
  }
  const batch = db.batch()
  for (const t of SHIFT_TEMPLATES) {
    const ref = db.collection('shiftTemplates').doc()
    batch.set(ref, { branchId: '001', name: t.name, startTime: t.startTime, endTime: t.endTime, targetHeadcount: t.targetHeadcount, active: true })
  }
  await batch.commit()
  console.log(`✓ ${SHIFT_TEMPLATES.length} shift templates`)
}

const STAFF = [
  { employeeNo: 'E001', displayName: 'Store Manager (TBD)', roles: ['store_manager'] },
  { employeeNo: 'E002', displayName: 'Shift Leader 1 (TBD)', roles: ['shift_leader'] },
  { employeeNo: 'E003', displayName: 'Shift Leader 2 (TBD)', roles: ['shift_leader'] },
  { employeeNo: 'E004', displayName: 'Kitchen Staff (TBD)', roles: ['kitchen_staff'] },
  { employeeNo: 'E005', displayName: 'Cashier 1 (TBD)', roles: ['cashier'] },
  { employeeNo: 'E006', displayName: 'Cashier 2 (TBD)', roles: ['cashier'] },
  { employeeNo: 'E007', displayName: 'Store Staff 1 (TBD)', roles: ['store_staff'] },
  { employeeNo: 'E008', displayName: 'Store Staff 2 (TBD)', roles: ['store_staff'] },
  { employeeNo: 'E009', displayName: 'Store Staff 3 (TBD)', roles: ['store_staff'] },
]

async function seedUsers() {
  const existing = await db.collection('users').where('branchIds', 'array-contains', '001').limit(1).get()
  if (!existing.empty) {
    console.log('· users already present, skipping (rotate PINs via resetUserPin, not by re-seeding)')
    return
  }

  const issuedPins: Array<{ employeeNo: string; displayName: string; pin: string }> = []
  const batch = db.batch()
  STAFF.forEach((s, i) => {
    const pin = String(1000 + i) // placeholder only — rotate before go-live, see RUNBOOK.md
    const pinHash = bcrypt.hashSync(pin, 10)
    issuedPins.push({ employeeNo: s.employeeNo, displayName: s.displayName, pin })
    const ref = db.collection('users').doc()
    batch.set(ref, {
      employeeNo: s.employeeNo,
      displayName: s.displayName,
      roles: s.roles,
      branchIds: ['001'],
      pinHash,
      authUid: null,
      status: 'active',
      certifications: {},
      hiredAt: now,
      createdAt: now,
    })
  })
  await batch.commit()

  console.log(`✓ ${STAFF.length} users seeded with placeholder PINs:`)
  console.table(issuedPins)
  console.log('These are printed once, here, and nowhere else. Rotate them at onboarding — see RUNBOOK.md.')
}

type ParamSeed = {
  key: string
  value: number | string | boolean | null
  dataType: 'currency' | 'number' | 'duration_minutes' | 'temperature_c' | 'time' | 'boolean' | 'enum'
  min?: number
  max?: number
  unit?: string
  owner: string
  signoff?: boolean
}

// Source of truth: G7 Operations Manual v1.2 Appendix A / Appendix G, as
// transcribed in docs/05-PARAMETERS.md. Do not add values not in that file.
const PARAMS: ParamSeed[] = [
  // 24/7 from day 9 (G7_WORK_ORDER_FINAL_1.md Decision 2, 2026-09-02) —
  // superseded from the original 06:00-24:00/scheduled seed. Kept in sync
  // with the branches/001 doc seedBranch() writes; see that function's
  // comment for why open_time/close_time stay populated rather than blank
  // even though the store never actually opens or closes at 24/7.
  { key: 'branch.operating_mode', value: '24_7', dataType: 'enum', owner: 'owner' },
  { key: 'branch.open_time', value: '07:00', dataType: 'time', owner: 'owner' },
  { key: 'branch.close_time', value: '07:00', dataType: 'time', owner: 'owner' },
  { key: 'branch.business_day_cutoff', value: '07:00', dataType: 'time', owner: 'owner' },
  { key: 'session.pin_timeout_minutes', value: 15, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },

  { key: 'service.greeting_seconds', value: 3, dataType: 'number', min: 1, max: 10, owner: 'store_manager' },
  { key: 'service.checkout_target_seconds', value: 30, dataType: 'number', min: 10, max: 120, owner: 'store_manager' },
  { key: 'service.queue_second_till_threshold', value: 5, dataType: 'number', min: 2, max: 15, owner: 'store_manager' },

  { key: 'fee.cooking_fee_regular', value: 4000, dataType: 'currency', unit: 'PHP_centavos', owner: 'owner' },
  { key: 'fee.cooking_fee_student', value: 3500, dataType: 'currency', unit: 'PHP_centavos', owner: 'owner' },
  { key: 'fee.cooking_fee_basis', value: 'per_transaction', dataType: 'enum', owner: 'owner' },
  { key: 'fee.student_proof_required', value: 'uniform_or_school_id', dataType: 'enum', owner: 'store_manager' },

  { key: 'cash.drawer_max_balance', value: 300000, dataType: 'currency', min: 100000, max: 1000000, unit: 'PHP_centavos', owner: 'owner' },
  { key: 'cash.drawer_alert_threshold', value: 250000, dataType: 'currency', min: 50000, max: 900000, unit: 'PHP_centavos', owner: 'store_manager' },
  { key: 'cash.drawer_max_after_2200', value: 200000, dataType: 'currency', min: 50000, max: 500000, unit: 'PHP_centavos', owner: 'store_manager' },
  { key: 'cash.opening_float', value: 200000, dataType: 'currency', min: 50000, max: 500000, unit: 'PHP_centavos', owner: 'store_manager' },
  { key: 'cash.drop_interval_minutes', value: 180, dataType: 'duration_minutes', min: 60, max: 480, unit: 'minutes', owner: 'store_manager' },
  { key: 'cash.variance_investigation_threshold', value: 10000, dataType: 'currency', min: 1000, max: 100000, unit: 'PHP_centavos', owner: 'store_manager' },
  { key: 'cash.shift_leader_approval_limit', value: 50000, dataType: 'currency', min: 10000, max: 200000, unit: 'PHP_centavos', owner: 'owner' },
  { key: 'cash.owner_writeoff_threshold', value: null, dataType: 'currency', unit: 'PHP_centavos', owner: 'owner' },

  { key: 'clean.ramyeon_station_interval_minutes', value: 30, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },
  { key: 'clean.dining_check_interval_minutes', value: 20, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },
  { key: 'clean.general_check_interval_minutes', value: 60, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },

  { key: 'equipment.temperature_reading_interval_minutes', value: 180, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },
  { key: 'equipment.reading_grace_minutes', value: 45, dataType: 'duration_minutes', unit: 'minutes', owner: 'store_manager' },
  { key: 'equipment.chiller_target_max_c', value: 4, dataType: 'temperature_c', unit: 'celsius', owner: 'owner', signoff: true },
  { key: 'equipment.freezer_target_max_c', value: null, dataType: 'temperature_c', unit: 'celsius', owner: 'owner', signoff: true },
  { key: 'equipment.max_excursion_minutes', value: null, dataType: 'duration_minutes', unit: 'minutes', owner: 'owner', signoff: true },

  { key: 'food.hot_holding_min_c', value: 60, dataType: 'temperature_c', unit: 'celsius', owner: 'owner', signoff: true },
  { key: 'food.cold_holding_max_c', value: 4, dataType: 'temperature_c', unit: 'celsius', owner: 'owner', signoff: true },
  { key: 'food.cooling_to_chiller_max_minutes', value: 120, dataType: 'duration_minutes', unit: 'minutes', owner: 'owner', signoff: true },
  { key: 'food.cooling_target_minutes', value: 60, dataType: 'duration_minutes', unit: 'minutes', owner: 'owner', signoff: true },
  { key: 'food.reheat_min_c', value: 74, dataType: 'temperature_c', unit: 'celsius', owner: 'owner', signoff: true },
  { key: 'food.reheat_max_count', value: 1, dataType: 'number', owner: 'owner', signoff: true },
  { key: 'food.hot_hold_max_minutes', value: 240, dataType: 'duration_minutes', unit: 'minutes', owner: 'owner', signoff: true },
  // Manual Appendix G gives these in hours; normalised to dataType 'number'
  // with unit 'hours' for consistency with the sibling use-by values below.
  { key: 'food.cooked_rice_useby_hours', value: 24, dataType: 'number', unit: 'hours', owner: 'owner', signoff: true },
  { key: 'food.gimbap_useby_hours', value: 24, dataType: 'number', unit: 'hours', owner: 'owner', signoff: true },
  { key: 'food.boiled_egg_useby_hours', value: 24, dataType: 'number', unit: 'hours', owner: 'owner', signoff: true },
  { key: 'food.prepped_filling_useby_hours', value: 24, dataType: 'number', unit: 'hours', owner: 'owner', signoff: true },
  { key: 'food.fried_items_permitted', value: false, dataType: 'boolean', owner: 'owner', signoff: true },

  { key: 'audio.quiet_hours_start', value: '00:00', dataType: 'time', owner: 'store_manager' },
  { key: 'audio.quiet_hours_end', value: '06:00', dataType: 'time', owner: 'store_manager' },

  { key: 'staff.headcount_target', value: 9, dataType: 'number', owner: 'owner' },
  { key: 'staff.seats_indoor', value: 36, dataType: 'number', owner: 'owner' },
  { key: 'staff.seats_outdoor', value: 12, dataType: 'number', owner: 'owner' },
  { key: 'staff.night_diff_start', value: '22:00', dataType: 'time', owner: 'owner' },
  { key: 'staff.night_diff_end', value: '06:00', dataType: 'time', owner: 'owner' },
  { key: 'staff.night_diff_rate_pct', value: 10, dataType: 'number', owner: 'owner' },
  { key: 'staff.probation_months', value: 6, dataType: 'number', owner: 'owner' },
  { key: 'staff.leave_eligibility_months', value: 6, dataType: 'number', owner: 'owner' },
  { key: 'staff.statutory_sil_eligibility_months', value: 12, dataType: 'number', owner: 'owner' },
  { key: 'staff.certification_expiry_warning_days', value: null, dataType: 'number', owner: 'owner' },

  { key: 'inventory.near_expiry_days_chilled', value: null, dataType: 'number', owner: 'store_manager' },
  { key: 'inventory.near_expiry_days_ambient', value: null, dataType: 'number', owner: 'store_manager' },
]

async function seedParameters() {
  const existing = await db.collection('parameters').limit(1).get()
  if (!existing.empty) {
    console.log('· parameters already present, skipping (edit via the manager UI, not by re-seeding)')
    return
  }
  const batches: FirebaseFirestore.WriteBatch[] = [db.batch()]
  let opsInBatch = 0
  function nextBatch() {
    if (opsInBatch >= 400) {
      batches.push(db.batch())
      opsInBatch = 0
    }
    opsInBatch++
    return batches[batches.length - 1]
  }

  for (const p of PARAMS) {
    const ref = db.collection('parameters').doc()
    nextBatch().set(ref, {
      key: p.key,
      scope: 'global',
      scopeId: null,
      value: p.value,
      dataType: p.dataType,
      minAllowed: p.min ?? null,
      maxAllowed: p.max ?? null,
      unit: p.unit ?? null,
      ownerRole: p.owner,
      effectiveFrom: now,
      effectiveTo: null,
      changedBy: 'seed',
      changedAt: now,
      reason: 'Initial seed from Operations Manual v1.2 Appendix A/G',
      requiresProfessionalSignoff: Boolean(p.signoff),
    })
  }
  for (const b of batches) await b.commit()
  console.log(`✓ ${PARAMS.length} parameters`)
}

async function main() {
  console.log(`Seeding ${usingEmulator ? 'EMULATOR' : 'LIVE PROJECT'}…`)
  await seedBranch()
  await seedRoles()
  await seedShiftTemplates()
  await seedUsers()
  await seedParameters()
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
