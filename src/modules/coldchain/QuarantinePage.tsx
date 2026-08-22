// docs/04-M1-COLDCHAIN.md §4 — every lot, item/qty/value/location/status.
// Crew cannot release one: no disposition control renders for them, and
// firestore.rules refuses the write even if this check were bypassed.
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { quarantineLotsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import { formatCentavos } from '@/lib/format'
import type { QuarantineLot } from '@/lib/types'
import { QuarantineDispositionDialog } from './QuarantineDispositionDialog'

type Row = QuarantineLot & { id: string }

export function QuarantinePage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const canRelease = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner'
  const [lots, setLots] = useState<Row[]>([])
  const [dispositioning, setDispositioning] = useState<Row | null>(null)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(quarantineLotsCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const open = lots.filter((l) => l.status === 'quarantined')
  const resolved = lots.filter((l) => l.status !== 'quarantined')

  return (
    <div className="quarantine-page">
      <h2>Quarantine</h2>

      <section className="card">
        <h2>Open</h2>
        {open.length === 0 && <p className="empty-state">Nothing quarantined right now.</p>}
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Value</th>
              <th>Location</th>
              {canRelease && <th></th>}
            </tr>
          </thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.id}>
                <td>{l.itemName}</td>
                <td>
                  {l.qty} {l.unit}
                </td>
                <td>{l.estValueCentavos !== null ? formatCentavos(l.estValueCentavos) : '—'}</td>
                <td>{l.location}</td>
                {canRelease && (
                  <td>
                    <button type="button" onClick={() => setDispositioning(l)}>
                      Disposition
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {resolved.length > 0 && (
        <section className="card">
          <h2>Resolved</h2>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Outcome</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((l) => (
                <tr key={l.id}>
                  <td>{l.itemName}</td>
                  <td>{l.status}</td>
                  <td>{l.disposition?.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {dispositioning && <QuarantineDispositionDialog lot={dispositioning} onClose={() => setDispositioning(null)} />}
    </div>
  )
}
