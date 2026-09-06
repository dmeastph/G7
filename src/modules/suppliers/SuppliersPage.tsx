// docs/17-M12-SUPPLIERS.md §1 — list, create, edit. No delete control
// anywhere — a supplier that stops being used is deactivated, never
// removed, so a receiving record or item's defaultSupplierId never dangles.
import { useEffect, useState } from 'react'
import { onSnapshot } from 'firebase/firestore'
import { suppliersCol } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import type { Supplier } from '@/lib/types'
import { SupplierFormDialog } from './SupplierFormDialog'

type SupplierRow = Supplier & { id: string }

export function SuppliersPage() {
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [editing, setEditing] = useState<SupplierRow | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    return onSnapshot(suppliersCol, (snap) => setSuppliers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [])

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view suppliers.</p>
      </div>
    )
  }

  const sorted = [...suppliers].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="suppliers-page">
      <div className="page-header">
        <h2>Suppliers</h2>
        <button type="button" onClick={() => setAdding(true)}>
          Add supplier
        </button>
      </div>

      {sorted.length === 0 && <p className="empty-state">No suppliers yet.</p>}

      {sorted.length > 0 && (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Contact</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.category}</td>
                  <td>{s.contactName ?? s.contactPhone ?? s.contactEmail ?? '—'}</td>
                  <td>{s.active ? 'active' : 'inactive'}</td>
                  <td>
                    <button type="button" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {adding && <SupplierFormDialog onClose={() => setAdding(false)} />}
      {editing && <SupplierFormDialog existing={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
