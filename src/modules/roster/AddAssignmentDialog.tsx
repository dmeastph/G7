// "Assigning a role checks certification before the write succeeds"
// (docs/08-M3-TIME-ROSTER-CERTIFICATION.md §3) — the one hard stop in this
// module, because it's the moment an uncertified person would otherwise
// start covering that role.
import { useState } from 'react'
import { useWriteOperational } from '@/lib/write'
import { meetsRoleRequirement } from '@/lib/certification'
import type { RoleCode, ShiftInstance, User } from '@/lib/types'

const ASSIGNABLE_ROLES: RoleCode[] = ['shift_leader', 'cashier', 'kitchen_staff', 'store_staff']

export function AddAssignmentDialog({
  shiftInstance,
  shiftInstanceId,
  users,
  onClose,
}: {
  shiftInstance: ShiftInstance
  shiftInstanceId: string
  users: (User & { id: string })[]
  onClose: () => void
}) {
  const { write } = useWriteOperational()
  const [userId, setUserId] = useState(users[0]?.id ?? '')
  const [role, setRole] = useState<RoleCode>('store_staff')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const user = users.find((u) => u.id === userId)
    if (!user) {
      setError('Pick a staff member.')
      return
    }
    const check = meetsRoleRequirement(user.certifications ?? {}, role, new Date())
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await write('rosterAssignments', {
        shiftInstanceId,
        userId: user.id,
        userName: user.displayName,
        role,
        status: 'planned',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this assignment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>Assign — {shiftInstance.templateName}</h3>
        <label>
          Staff
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as RoleCode)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
