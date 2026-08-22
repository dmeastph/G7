// Loads the branch's actual equipment list (owner-supplied, 2026-08-21).
// Thresholds are left unset deliberately — nobody has given target ranges
// for these specific units yet, and inventing food-safety numbers is the
// one thing this system must never do (docs/03-M0-FOUNDATION.md §6,
// docs/05-PARAMETERS.md). A manager sets real thresholds via the
// Equipment screen once the technician/manufacturer specs are in hand.
//
// Re-run is safe: skips entirely if any equipment already exists for the
// branch, so it never duplicates or clobbers manager edits.
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

if (usingEmulator) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-g7-ops' })
} else {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  initializeApp({ credential: keyPath ? cert(JSON.parse(readFileSync(keyPath, 'utf8'))) : applicationDefault() })
}

const db = getFirestore()
const BRANCH_ID = '001'

type Row = {
  assetIdPrefix: string
  type:
    | 'chiller'
    | 'freezer'
    | 'chest_freezer'
    | 'undercounter'
    | 'cooker'
    | 'microwave'
    | 'rice_cooker'
    | 'hot_hold'
    | 'fryer'
    | 'aircon'
    | 'other'
  zone: string
  count: number
  requiresTemperatureLog: boolean
  notes?: string
}

// Zones are best-guess placement for a store this layout, except the three
// the owner specified explicitly (stock room / kitchen / toppings counter)
// — adjust freely via the Equipment screen, nothing here is load-bearing.
const ROWS: Row[] = [
  { assetIdPrefix: 'CH', type: 'chiller', zone: 'Sales floor', count: 2, requiresTemperatureLog: true, notes: '3-door chiller' },
  { assetIdPrefix: 'FZ', type: 'freezer', zone: 'Sales floor', count: 1, requiresTemperatureLog: true, notes: '3-door freezer' },
  { assetIdPrefix: 'ISF', type: 'chest_freezer', zone: 'Sales floor', count: 2, requiresTemperatureLog: true, notes: 'Island freezer' },
  { assetIdPrefix: 'UFZ', type: 'freezer', zone: 'Stock room', count: 1, requiresTemperatureLog: true, notes: 'Upright freezer' },
  { assetIdPrefix: 'UCH', type: 'chiller', zone: 'Kitchen', count: 1, requiresTemperatureLog: true, notes: 'Upright chiller' },
  { assetIdPrefix: 'UCF', type: 'undercounter', zone: 'Toppings counter', count: 1, requiresTemperatureLog: true, notes: 'Undercounter freezer' },
  { assetIdPrefix: 'WD', type: 'other', zone: 'Service counter', count: 1, requiresTemperatureLog: false, notes: 'Water dispenser (hot and cold)' },
  { assetIdPrefix: 'IC', type: 'cooker', zone: 'Kitchen', count: 1, requiresTemperatureLog: false, notes: 'Induction cooker' },
  { assetIdPrefix: 'RC', type: 'rice_cooker', zone: 'Kitchen', count: 1, requiresTemperatureLog: false, notes: 'Rice cooker' },
  { assetIdPrefix: 'RIC', type: 'cooker', zone: 'Ramyeon station', count: 5, requiresTemperatureLog: false, notes: 'Ramyeon induction cooker' },
  { assetIdPrefix: 'MW', type: 'microwave', zone: 'Service counter', count: 2, requiresTemperatureLog: false, notes: 'Microwave oven' },
  { assetIdPrefix: 'HWD', type: 'other', zone: 'Kitchen', count: 1, requiresTemperatureLog: false, notes: 'Hot water dispenser' },
  { assetIdPrefix: 'RH', type: 'other', zone: 'Kitchen', count: 1, requiresTemperatureLog: false, notes: 'Rangehood' },
  { assetIdPrefix: 'AC', type: 'aircon', zone: 'Dining area', count: 2, requiresTemperatureLog: false, notes: 'Floor standing aircon, 3TR' },
  { assetIdPrefix: 'CAC', type: 'aircon', zone: 'Dining area', count: 1, requiresTemperatureLog: false, notes: 'Cassette type aircon, 3TR' },
  { assetIdPrefix: 'MB', type: 'other', zone: 'Sales floor', count: 2, requiresTemperatureLog: false, notes: '32" menu board' },
  { assetIdPrefix: 'TV', type: 'other', zone: 'Dining area', count: 1, requiresTemperatureLog: false, notes: '65" Huawei TV' },
  { assetIdPrefix: 'SPK', type: 'other', zone: 'Dining area', count: 2, requiresTemperatureLog: false, notes: 'Speaker' },
  { assetIdPrefix: 'AMP', type: 'other', zone: 'Dining area', count: 1, requiresTemperatureLog: false, notes: 'Amplifier' },
]

async function seedEquipment() {
  const existing = await db.collection('equipment').where('branchId', '==', BRANCH_ID).limit(1).get()
  if (!existing.empty) {
    console.log('· equipment already present for branch 001, skipping (edit via the Equipment screen, not by re-seeding)')
    return
  }

  const batch = db.batch()
  let total = 0
  for (const row of ROWS) {
    for (let i = 1; i <= row.count; i++) {
      const assetId = row.count === 1 ? row.assetIdPrefix : `${row.assetIdPrefix}-${String(i).padStart(2, '0')}`
      const ref = db.collection('equipment').doc()
      batch.set(ref, {
        branchId: BRANCH_ID,
        assetId,
        type: row.type,
        make: '',
        model: '',
        serial: '',
        supplier: '',
        purchaseDate: null,
        warrantyExpiry: null,
        zone: row.zone,
        status: 'active',
        requiresTemperatureLog: row.requiresTemperatureLog,
        thresholds: null,
        thresholdSource: 'unset',
        notes: row.notes ?? '',
      })
      total++
    }
  }
  await batch.commit()
  console.log(`✓ ${total} equipment units seeded for branch 001`)
  console.log('Thresholds are unset on every cold-chain unit — set real target ranges via the Equipment screen once known.')
}

seedEquipment()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
