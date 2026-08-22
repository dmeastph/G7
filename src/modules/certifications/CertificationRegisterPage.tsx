// docs/08-M3-TIME-ROSTER-CERTIFICATION.md §5 — current certifications per
// user, expired ones shown plainly as expired, not silently dropped.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { usersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { CERT_LEVELS, MODULE_F, isCertificationActive } from '@/lib/certification'
import type { User } from '@/lib/types'
import { CertificationDialog } from './CertificationDialog'

type Row = User & { id: string }
const LEVEL_ORDER = [...CERT_LEVELS, MODULE_F]

export function CertificationRegisterPage() {
  const activeBranch = useActiveBranch()
  const [users, setUsers] = useState<Row[]>([])
  const [certifying, setCertifying] = useState<Row | null>(null)
  const [now] = useState(new Date())

  useEffect(() => {
    if (!activeBranch) return
    const q = query(usersCol, where('branchIds', 'array-contains', activeBranch.branchId), where('status', '==', 'active'))
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  return (
    <div className="certifications-page">
      <h2>Certification register</h2>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              {LEVEL_ORDER.map((l) => (
                <th key={l}>{l === MODULE_F ? 'Module F' : l}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                {LEVEL_ORDER.map((l) => {
                  const cert = u.certifications?.[l]
                  const active = isCertificationActive(cert, now)
                  return (
                    <td key={l} className={cert && !active ? 'status-page__out-of-range' : ''}>
                      {!cert ? '—' : active ? 'active' : 'expired'}
                    </td>
                  )
                })}
                <td>
                  <button type="button" onClick={() => setCertifying(u)}>
                    Certify
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {certifying && <CertificationDialog user={certifying} onClose={() => setCertifying(null)} />}
    </div>
  )
}
