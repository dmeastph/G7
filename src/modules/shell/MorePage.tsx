// Lower-frequency screens that don't earn a bottom-nav slot: equipment and
// checklist template management (manager), the small logs, and quarantine
// / tickets (used often enough to need a tap, rarely enough not to need a
// permanent one).
import { Link } from 'react-router-dom'
import { useAuth, signOut } from '@/lib/auth'

export function MorePage() {
  const auth = useAuth()
  const isManager = auth.claims?.role === 'store_manager' || auth.claims?.role === 'owner' || auth.claims?.role === 'ops_head'

  return (
    <div className="more-page">
      <h2>More</h2>
      <section className="card">
        <h2>Account</h2>
        <p>{auth.mode === 'managed' || auth.mode === 'station' ? auth.user.email : null}</p>
        <button type="button" onClick={() => signOut()}>
          Sign out
        </button>
      </section>
      <section className="card">
        <h2>Dashboard</h2>
        <ul>
          <li>
            <Link to="/dashboard">Dashboard</Link>
          </li>
          <li>
            <Link to="/dashboard/digests">Digest history</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Cold chain</h2>
        <ul>
          <li>
            <Link to="/coldchain/quarantine">Quarantine</Link>
          </li>
          <li>
            <Link to="/coldchain/tickets">Maintenance tickets</Link>
          </li>
          {isManager && (
            <li>
              <Link to="/coldchain/equipment">Equipment</Link>
            </li>
          )}
        </ul>
      </section>
      <section className="card">
        <h2>Cash</h2>
        <ul>
          <li>
            <Link to="/cash">Cash session</Link>
          </li>
          <li>
            <Link to="/cash/exceptions">Void / refund / override / no-sale</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Incidents</h2>
        <ul>
          <li>
            <Link to="/incidents">Incidents</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Handover</h2>
        <ul>
          <li>
            <Link to="/handover">Shift handover</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Documents</h2>
        <ul>
          <li>
            <Link to="/documents">Documents</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Time</h2>
        <ul>
          <li>
            <Link to="/time/my-shift">My shift</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Self-service</h2>
        <ul>
          <li>
            <Link to="/self">My self-service</Link>
          </li>
          <li>
            <Link to="/self/leave">Leave</Link>
          </li>
          <li>
            <Link to="/self/disputes">My flagged entries</Link>
          </li>
        </ul>
      </section>
      <section className="card">
        <h2>Logs</h2>
        <ul>
          <li>
            <Link to="/logs/queue">Queue escalation</Link>
          </li>
          <li>
            <Link to="/logs/wastage">Wastage</Link>
          </li>
          <li>
            <Link to="/logs/receiving">Receiving</Link>
          </li>
          <li>
            <Link to="/inventory/consumption">Log consumption</Link>
          </li>
        </ul>
      </section>
      {isManager && (
        <section className="card">
          <h2>Manager</h2>
          <ul>
            <li>
              <Link to="/checklists/templates">Checklist templates</Link>
            </li>
            <li>
              <Link to="/roster">Roster</Link>
            </li>
            <li>
              <Link to="/certifications">Certification register</Link>
            </li>
            <li>
              <Link to="/time/export">Verified hours export</Link>
            </li>
            <li>
              <Link to="/parameters">Parameters</Link>
            </li>
            <li>
              <Link to="/catalogue">Catalogue</Link>
            </li>
            <li>
              <Link to="/inventory">Inventory</Link>
            </li>
            <li>
              <Link to="/documents-register">Acknowledgment register</Link>
            </li>
            <li>
              <Link to="/leave/approvals">Leave approvals</Link>
            </li>
            <li>
              <Link to="/self/disputes">Dispute inbox</Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}
