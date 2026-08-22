// docs/04-M1-COLDCHAIN.md §5 — "Closed tickets stay on the unit's service
// history": nothing here ever deletes a ticket, closing just changes status.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { maintenanceTicketsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import type { MaintenanceTicket } from '@/lib/types'
import { TicketCloseDialog } from './TicketCloseDialog'

type Row = MaintenanceTicket & { id: string }

export function TicketsPage() {
  const activeBranch = useActiveBranch()
  const [tickets, setTickets] = useState<Row[]>([])
  const [closing, setClosing] = useState<Row | null>(null)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(maintenanceTicketsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const open = tickets.filter((t) => t.status !== 'closed')
  const closed = tickets.filter((t) => t.status === 'closed')

  return (
    <div className="tickets-page">
      <h2>Maintenance tickets</h2>

      <section className="card">
        <h2>Open</h2>
        {open.length === 0 && <p className="empty-state">No open tickets.</p>}
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Symptom</th>
              <th>Impact</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {open.map((t) => (
              <tr key={t.id}>
                <td>{t.assetId}</td>
                <td>{t.symptom}</td>
                <td>{t.tradeImpact}</td>
                <td>{t.status}</td>
                <td>
                  <button type="button" onClick={() => setClosing(t)}>
                    Close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {closed.length > 0 && (
        <section className="card">
          <h2>Service history</h2>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Symptom</th>
                <th>Verified by</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((t) => (
                <tr key={t.id}>
                  <td>{t.assetId}</td>
                  <td>{t.symptom}</td>
                  <td>{t.verifiedWorkingBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {closing && <TicketCloseDialog ticket={closing} onClose={() => setClosing(null)} />}
    </div>
  )
}
