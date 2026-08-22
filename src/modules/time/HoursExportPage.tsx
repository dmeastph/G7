// docs/08-M3-TIME-ROSTER-CERTIFICATION.md §6 — verified hours, not payroll.
import { useState } from 'react'
import { getDocs, query, Timestamp, where } from 'firebase/firestore'
import { timeEntriesCol, usersCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useParam } from '@/lib/params'
import { summarizeShifts } from '@/lib/hours'
import type { TimeEntry } from '@/lib/types'

type Row = { userId: string; userName: string; regularMinutes: number; nightMinutes: number; breakMinutes: number }

function fmtHours(min: number): string {
  return (min / 60).toFixed(2)
}

function downloadCsv(rows: Row[], from: string, to: string) {
  const header = 'User,Regular hours,Night differential hours,Break hours\n'
  const body = rows.map((r) => `${r.userName},${fmtHours(r.regularMinutes)},${fmtHours(r.nightMinutes)},${fmtHours(r.breakMinutes)}`).join('\n')
  const blob = new Blob([header + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `verified-hours-${from}-to-${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function HoursExportPage() {
  const activeBranch = useActiveBranch()
  const nightStartParam = useParam('staff.night_diff_start')
  const nightEndParam = useParam('staff.night_diff_end')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!activeBranch || !from || !to) {
      setError('Pick a date range.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fromDate = new Date(`${from}T00:00:00+08:00`)
      const toDate = new Date(`${to}T23:59:59+08:00`)
      const [entriesSnap, usersSnap] = await Promise.all([
        getDocs(
          query(
            timeEntriesCol,
            where('branchId', '==', activeBranch.branchId),
            where('at', '>=', Timestamp.fromDate(fromDate)),
            where('at', '<=', Timestamp.fromDate(toDate)),
          ),
        ),
        getDocs(query(usersCol, where('branchIds', 'array-contains', activeBranch.branchId))),
      ])

      const nameById = new Map(usersSnap.docs.map((d) => [d.id, d.data().displayName]))
      const byUser = new Map<string, TimeEntry[]>()
      entriesSnap.forEach((d) => {
        const e = d.data()
        const list = byUser.get(e.userId) ?? []
        list.push(e)
        byUser.set(e.userId, list)
      })

      const nightStart = nightStartParam.isSet ? String(nightStartParam.value) : '22:00'
      const nightEnd = nightEndParam.isSet ? String(nightEndParam.value) : '06:00'

      const result: Row[] = []
      for (const [userId, entries] of byUser) {
        const summaries = summarizeShifts(entries, nightStart, nightEnd)
        result.push({
          userId,
          userName: nameById.get(userId) ?? userId,
          regularMinutes: summaries.reduce((s, x) => s + x.regularMinutes, 0),
          nightMinutes: summaries.reduce((s, x) => s + x.nightDifferentialMinutes, 0),
          breakMinutes: summaries.reduce((s, x) => s + x.breakMinutes, 0),
        })
      }
      setRows(result.sort((a, b) => a.userName.localeCompare(b.userName)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build this report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hours-export-page">
      <h2>Verified hours export</h2>
      <section className="card">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {error && <p className="dialog__error">{error}</p>}
        <button type="button" onClick={run} disabled={busy}>
          {busy ? 'Building…' : 'Build report'}
        </button>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Regular (h)</th>
                <th>Night diff (h)</th>
                <th>Break (h)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.userName}</td>
                  <td>{fmtHours(r.regularMinutes)}</td>
                  <td>{fmtHours(r.nightMinutes)}</td>
                  <td>{fmtHours(r.breakMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => downloadCsv(rows, from, to)}>
            Download CSV
          </button>
        </section>
      )}
    </div>
  )
}
