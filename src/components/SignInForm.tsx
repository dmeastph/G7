// Tier 1 auth — managed account (manager) or the station device account.
// Both are plain Firebase email/password; role comes from the custom claim.
import { useState, type FormEvent } from 'react'
import { signIn } from '@/lib/auth'

export function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch {
      setError('Sign-in failed. Check the email and password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sign-in-screen">
      <form className="sign-in-form" onSubmit={handleSubmit}>
        <h1>G7 Operations</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="sign-in-form__error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
