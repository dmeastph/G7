// Manager UI to view and edit parameters. A non-manager must not be able to
// reach this screen, and the rules must refuse the write even if they do
// (docs/03-M0-FOUNDATION.md acceptance criteria).
import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { useAllParams, type CachedParam } from '@/lib/params'
import { formatParamValue } from '@/lib/format'
import { ParamEditDialog } from './ParamEditDialog'

export function ParamsAdminPage() {
  const auth = useAuth()
  const params = useAllParams()
  const [editing, setEditing] = useState<CachedParam | null>(null)

  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  if (!isManager) {
    return (
      <div className="card">
        <p>Only a manager can view parameters.</p>
      </div>
    )
  }

  const sorted = [...params].sort((a, b) => a.key.localeCompare(b.key))

  return (
    <div className="params-admin">
      <h2>Parameters</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Scope</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.id}>
              <td>
                {p.key}
                {p.requiresProfessionalSignoff && <span className="params-admin__signoff-badge">sign-off</span>}
              </td>
              <td className={p.value === null ? 'param-value--unset' : ''}>{formatParamValue(p)}</td>
              <td>{p.scope}</td>
              <td>
                <button type="button" onClick={() => setEditing(p)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <ParamEditDialog param={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
