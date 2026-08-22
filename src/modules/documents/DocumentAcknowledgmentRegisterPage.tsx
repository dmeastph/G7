// docs/12-M7-DOCUMENT-CONTROL.md §4 — same matrix shape as
// CertificationRegisterPage: staff down the rows, active documents across
// the columns, acknowledged/not per cell.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { documentAcknowledgmentsCol, documentsCol, usersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import type { DocumentAcknowledgment, DocumentRecord, User } from '@/lib/types'

type UserRow = User & { id: string }
type DocRow = DocumentRecord & { id: string }

export function DocumentAcknowledgmentRegisterPage() {
  const activeBranch = useActiveBranch()
  const [users, setUsers] = useState<UserRow[]>([])
  const [docs, setDocs] = useState<DocRow[]>([])
  const [acks, setAcks] = useState<(DocumentAcknowledgment & { id: string })[]>([])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(usersCol, where('branchIds', 'array-contains', activeBranch.branchId), where('status', '==', 'active'))
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(documentsCol, where('branchId', '==', activeBranch.branchId), where('active', '==', true))
    return onSnapshot(q, (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(documentAcknowledgmentsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setAcks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const ackSet = new Set(acks.map((a) => `${a.actorId}::${a.documentId}`))
  const sortedDocs = [...docs].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="document-register-page">
      <h2>Acknowledgment register</h2>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              {sortedDocs.map((d) => (
                <th key={d.id}>{d.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                {sortedDocs.map((d) => (
                  <td key={d.id}>{ackSet.has(`${u.id}::${d.id}`) ? 'acknowledged' : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
