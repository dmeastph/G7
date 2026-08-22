// docs/04-M1-COLDCHAIN.md §1 — list by zone with current status; manager
// can add/edit, crew read-only (enforced in firestore.rules, not just here).
import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { equipmentCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useAuth } from '@/lib/auth'
import type { Equipment } from '@/lib/types'
import { EquipmentFormDialog } from './EquipmentFormDialog'

type EquipmentRow = Equipment & { id: string }

function thresholdText(eq: Equipment): string {
  if (!eq.thresholds || (eq.thresholds.minC === null && eq.thresholds.maxC === null)) return 'target not set'
  const { minC, maxC } = eq.thresholds
  if (minC !== null && maxC !== null) return `${minC}–${maxC}°C`
  if (maxC !== null) return `≤ ${maxC}°C`
  if (minC !== null) return `≥ ${minC}°C`
  return 'target not set'
}

export function EquipmentListPage() {
  const activeBranch = useActiveBranch()
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [units, setUnits] = useState<EquipmentRow[]>([])
  const [editing, setEditing] = useState<EquipmentRow | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!activeBranch) return
    const q = query(equipmentCol, where('branchId', '==', activeBranch.branchId))
    return onSnapshot(q, (snap) => setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const byZone = new Map<string, EquipmentRow[]>()
  for (const u of units) {
    const list = byZone.get(u.zone || 'Unassigned') ?? []
    list.push(u)
    byZone.set(u.zone || 'Unassigned', list)
  }

  return (
    <div className="equipment-page">
      <div className="page-header">
        <h2>Equipment</h2>
        {isManager && (
          <button type="button" onClick={() => setAdding(true)}>
            Add equipment
          </button>
        )}
      </div>

      {units.length === 0 && <p className="empty-state">No equipment registered yet.</p>}

      {Array.from(byZone.entries()).map(([zone, list]) => (
        <section className="card" key={zone}>
          <h2>{zone}</h2>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Status</th>
                <th>Threshold</th>
                {isManager && <th></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>{u.assetId}</td>
                  <td>{u.type}</td>
                  <td>{u.status}</td>
                  <td className={!u.thresholds ? 'param-value--unset' : ''}>{thresholdText(u)}</td>
                  {isManager && (
                    <td>
                      <button type="button" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {adding && <EquipmentFormDialog onClose={() => setAdding(false)} />}
      {editing && <EquipmentFormDialog existing={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
