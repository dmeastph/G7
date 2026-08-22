// "One screen: every unit, last reading, time since, in or out of range,
// open excursions, open quarantine, open tickets, and readings missed
// today. This is what the Store Manager looks at each morning."
// (docs/04-M1-COLDCHAIN.md §6)
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { onSnapshot, query, where } from 'firebase/firestore'
import { businessDaysCol, equipmentCol, excursionsCol, maintenanceTicketsCol, quarantineLotsCol, temperatureReadingsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { useParam } from '@/lib/params'
import { formatMinutesSince, toMillisSafe } from '@/lib/format'
import { generateSlots, slotStatus, type Slot } from '@/lib/coldchain'
import type { BusinessDay, Equipment, Excursion, MaintenanceTicket, QuarantineLot, TemperatureReading } from '@/lib/types'

type EquipmentRow = Equipment & { id: string }

export function ColdChainStatusPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const intervalParam = useParam('equipment.temperature_reading_interval_minutes')
  const graceParam = useParam('equipment.reading_grace_minutes')

  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null)
  const [units, setUnits] = useState<EquipmentRow[]>([])
  const [todaysReadings, setTodaysReadings] = useState<(TemperatureReading & { id: string })[]>([])
  const [excursions, setExcursions] = useState<(Excursion & { id: string })[]>([])
  const [openLots, setOpenLots] = useState<(QuarantineLot & { id: string })[]>([])
  const [openTickets, setOpenTickets] = useState<(MaintenanceTicket & { id: string })[]>([])
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!businessDayId) return
    return onSnapshot(query(businessDaysCol, where('__name__', '==', businessDayId)), (snap) => {
      setBusinessDay(snap.docs[0]?.data() ?? null)
    })
  }, [businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(
      equipmentCol,
      where('branchId', '==', activeBranch.branchId),
      where('requiresTemperatureLog', '==', true),
    )
    return onSnapshot(q, (snap) => setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    const q = query(
      temperatureReadingsCol,
      where('branchId', '==', activeBranch.branchId),
      where('businessDayId', '==', businessDayId),
    )
    return onSnapshot(q, (snap) => setTodaysReadings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch, businessDayId])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(
      excursionsCol,
      where('branchId', '==', activeBranch.branchId),
      where('status', 'in', ['open', 'recovered', 'quarantined']),
    )
    return onSnapshot(q, (snap) => setExcursions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(quarantineLotsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'quarantined'))
    return onSnapshot(q, (snap) => setOpenLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  useEffect(() => {
    if (!activeBranch) return
    const q = query(
      maintenanceTicketsCol,
      where('branchId', '==', activeBranch.branchId),
      where('status', 'in', ['open', 'attended']),
    )
    return onSnapshot(q, (snap) => setOpenTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [activeBranch])

  const graceMinutes = graceParam.isSet && typeof graceParam.value === 'number' ? graceParam.value : 45

  const slots: Slot[] = useMemo(() => {
    if (!businessDay || !intervalParam.isSet || typeof intervalParam.value !== 'number') return []
    return generateSlots(businessDay.opensAt.toDate(), businessDay.closesAt.toDate(), intervalParam.value)
  }, [businessDay, intervalParam])

  const lastReadingByEquipment = new Map<string, TemperatureReading & { id: string }>()
  for (const r of todaysReadings) {
    const existing = lastReadingByEquipment.get(r.equipmentId)
    if (!existing || toMillisSafe(r.readAt) > toMillisSafe(existing.readAt)) lastReadingByEquipment.set(r.equipmentId, r)
  }

  let missedToday = 0
  for (const u of units) {
    const doneLabels = new Set(todaysReadings.filter((r) => r.equipmentId === u.id).map((r) => r.scheduledSlot ?? ''))
    for (const slot of slots) {
      if (slotStatus(slot, now, graceMinutes, doneLabels.has(slot.label)) === 'missed') missedToday++
    }
  }

  return (
    <div className="status-page">
      <h2>Cold chain status</h2>

      <div className="status-summary">
        <div className="status-summary__tile">
          <span className="status-summary__count">{excursions.length}</span>
          <span>open excursions</span>
        </div>
        <div className="status-summary__tile">
          <span className="status-summary__count">{openLots.length}</span>
          <span>open quarantine</span>
        </div>
        <div className="status-summary__tile">
          <span className="status-summary__count">{openTickets.length}</span>
          <span>open tickets</span>
        </div>
        <div className="status-summary__tile">
          <span className="status-summary__count">{missedToday}</span>
          <span>readings missed today</span>
        </div>
      </div>

      <section className="card">
        <h2>Units</h2>
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Zone</th>
              <th>Last reading</th>
              <th>Time since</th>
              <th>Range</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const last = lastReadingByEquipment.get(u.id)
              return (
                <tr key={u.id}>
                  <td>{u.assetId}</td>
                  <td>{u.zone}</td>
                  <td>{last ? `${last.valueC}°C` : 'no reading today'}</td>
                  <td>{last ? formatMinutesSince(last.readAt, now) : '—'}</td>
                  <td className={last?.withinRange === false ? 'status-page__out-of-range' : ''}>
                    {last ? (last.withinRange === null ? 'target not set' : last.withinRange ? 'in range' : 'OUT OF RANGE') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {excursions.length > 0 && (
        <section className="card">
          <h2>Excursions</h2>
          <ul>
            {excursions.map((e) => (
              <li key={e.id}>
                <Link to={`/coldchain/excursions/${e.id}`}>
                  {e.assetId} — {e.status} — peak {e.peakC}°C
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
