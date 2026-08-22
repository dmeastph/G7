// Creates (or updates) the dedicated station account for a branch — signs
// in once on the tablet and stays signed in (docs/01-ARCHITECTURE.md).
// Usage: tsx scripts/setupStation.ts station-001@g7.internal <password> 001
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

const [email, password, branchId = '001'] = process.argv.slice(2)

if (!email || !password) {
  console.error('Usage: tsx scripts/setupStation.ts <email> <password> [branchId=001]')
  process.exit(1)
}

async function main() {
  const auth = getAuth()
  let user
  try {
    user = await auth.getUserByEmail(email)
    await auth.updateUser(user.uid, { password })
  } catch {
    user = await auth.createUser({ email, password })
  }
  await auth.setCustomUserClaims(user.uid, { role: 'station', branchId })
  console.log(`✓ station account ${email} (${user.uid}) for branch ${branchId}`)
  console.log('Sign in with this email/password once on the tablet — it stays signed in.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
