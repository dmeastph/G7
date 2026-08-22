// M0 ships no operational screens — "M0 ships when the plumbing is right,
// and a test write is the only write it makes" (docs/03-M0-FOUNDATION.md).
// This page exists to demonstrate that plumbing, not to be a real feature.
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId, useCurrentShift, setShiftOverride } from '@/lib/businessDay'
import { useWriteOperational } from '@/lib/write'
import { ParamValue } from '@/components/ParamValue'
import { ShiftOverridePicker } from './ShiftOverridePicker'

export function HomePage() {
  const auth = useAuth()
  const { actor } = usePinSession()
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const shift = useCurrentShift()
  const { write } = useWriteOperational()
  const [testResult, setTestResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  async function sendTestWrite() {
    setBusy(true)
    setTestResult(null)
    try {
      const id = await write('testWrites', { note: 'M0 plumbing check', from: actor?.displayName ?? auth.claims?.role })
      setTestResult(`Write queued/saved — testWrites/${id}`)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Write failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="home-page">
      <section className="card">
        <h2>Branch</h2>
        <p>{activeBranch ? `${activeBranch.branch.name} (${activeBranch.branchId})` : 'Resolving…'}</p>
        <p>Business day: {businessDayId ?? 'resolving…'}</p>
        <p>
          Current shift:{' '}
          {shift ? `${shift.templateName} (${shift.status})` : 'no shift covers this moment'}
        </p>
        {isManager && <ShiftOverridePicker />}
        {isManager && shift && (
          <button type="button" onClick={() => setShiftOverride(null)}>
            Clear override
          </button>
        )}
      </section>

      <section className="card">
        <h2>Parameters (seed check)</h2>
        <dl>
          <dt>cash.drawer_max_balance</dt>
          <dd><ParamValue paramKey="cash.drawer_max_balance" /></dd>
          <dt>food.hot_holding_min_c</dt>
          <dd><ParamValue paramKey="food.hot_holding_min_c" /></dd>
          <dt>equipment.freezer_target_max_c</dt>
          <dd><ParamValue paramKey="equipment.freezer_target_max_c" /></dd>
        </dl>
      </section>

      <section className="card">
        <h2>Write path check</h2>
        <p>Actor: {actor?.displayName ?? (auth.mode === 'managed' ? auth.user.email : 'none set')}</p>
        <button type="button" onClick={sendTestWrite} disabled={busy}>
          {busy ? 'Writing…' : 'Send test write'}
        </button>
        {testResult && <p>{testResult}</p>}
      </section>
    </div>
  )
}
