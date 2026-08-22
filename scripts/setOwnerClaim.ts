// Bootstraps the first owner account. Nothing else can — setUserRole
// requires an existing owner to call it (docs/03-M0-FOUNDATION.md §4).
// Usage: tsx scripts/setOwnerClaim.ts owner@example.com
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { readFileSync } from 'node:fs'

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)

if (usingEmulator) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-g7-ops' })
} else {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  initializeApp({ credential: keyPath ? cert(JSON.parse(readFileSync(keyPath, 'utf8'))) : applicationDefault() })
}

const email = process.argv[2]
const branchId = process.argv[3] ?? '001'

if (!email) {
  console.error('Usage: tsx scripts/setOwnerClaim.ts <email> [branchId=001]')
  process.exit(1)
}

async function main() {
  const user = await getAuth().getUserByEmail(email)
  await getAuth().setCustomUserClaims(user.uid, { role: 'owner', branchId })
  console.log(`✓ ${email} (${user.uid}) is now owner, branchId=${branchId}`)
  console.log('They must sign out and back in (or wait for their next token refresh) for this to take effect.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
