// docs/09-M4-CASH-CONTROL.md §6 — the void/refund/override/no-sale log.
// This system doesn't perform these (no POS integration); it records that
// they happened, for the same reason the manual requires a paper twin.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { cashRegisterExceptionsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { usePinSession } from '@/lib/pin'
import { useParam } from '@/lib/params'
import { formatCentavos, toMillisSafe } from '@/lib/format'
import { useCashActions } from './actions'
import type { CashRegisterException, CashRegisterExceptionType } from '@/lib/types'

type Row = CashRegisterException & { id: string }

const TYPE_LABEL: Record<CashRegisterExceptionType, string> = {
  void: 'Void',
  refund: 'Refund',
  override: 'Override',
  no_sale: 'No sale',
}

export function CashRegisterExceptionsPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const { actor } = usePinSession()
  const actions = useCashActions()
  const approvalLimitParam = useParam('cash.shift_leader_approval_limit')
  const approvalLimit = approvalLimitParam.isSet && typeof approvalLimitParam.value === 'number' ? approvalLimitParam.value : null

  const role = auth.claims?.role ?? null
  const isSupervisor = role === 'shift_leader' || role === 'store_manager' || role === 'owner' || role === 'ops_head'
  const who = actor
    ? { userId: actor.userId, userName: actor.displayName }
    : auth.mode === 'managed'
      ? { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
      : null

  const [rows, setRows] = useState<Row[]>([])
  const [type, setType] = useState<CashRegisterExceptionType>('void')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(cashRegisterExceptionsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  async function submit() {
    if (!reason.trim()) {
      setError('A reason is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const amountCentavos = amount.trim() === '' ? null : Math.round(Number(amount) * 100)
      const approvalRequired = amountCentavos !== null && approvalLimit !== null && amountCentavos > approvalLimit
      const openSession = await actions.findOpenSession()
      await actions.logRegisterException(openSession?.id ?? null, type, amountCentavos, reason.trim(), approvalRequired)
      setAmount('')
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this.')
    } finally {
      setBusy(false)
    }
  }

  async function approve(id: string) {
    if (!who) return
    setBusy(true)
    try {
      await actions.approveRegisterException(id, who.userName)
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...rows].sort((a, b) => toMillisSafe(b.createdAt) - toMillisSafe(a.createdAt))

  return (
    <div className="cash-exceptions-page">
      <h2>Void / refund / override / no-sale</h2>
      <section className="card">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as CashRegisterExceptionType)}>
            <option value="void">Void</option>
            <option value="refund">Refund</option>
            <option value="override">Override</option>
            <option value="no_sale">No sale</option>
          </select>
        </label>
        {type !== 'no_sale' && (
          <label>
            Amount (₱, optional)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
        )}
        <label>
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Recording…' : 'Record'}
        </button>
      </section>

      <section className="card">
        <h2>Recent</h2>
        {sorted.length === 0 && <p className="empty-state">Nothing recorded yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>{TYPE_LABEL[r.type]}</td>
                <td>{r.amountCentavos !== null ? formatCentavos(r.amountCentavos) : '—'}</td>
                <td>{r.reason}</td>
                <td>
                  {!r.approvalRequired && '—'}
                  {r.approvalRequired && r.approvedBy && `Approved by ${r.approvedBy}`}
                  {r.approvalRequired && !r.approvedBy && (
                    <>
                      <span className="dialog__warning">Unapproved</span>
                      {isSupervisor && (
                        <button type="button" onClick={() => approve(r.id)} disabled={busy}>
                          Approve
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
