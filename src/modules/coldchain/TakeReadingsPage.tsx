// "The most important screen in the app" — docs/04-M1-COLDCHAIN.md §2.
// One tap from home, due/overdue/missed per unit, tap → keypad → save,
// target under 20 seconds. Never pre-fills the previous reading.
import { useEffect, useMemo, useState } from 'react'
import { getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { businessDaysCol, equipmentCol, exceptionsCol, temperatureReadingsCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId } from '@/lib/businessDay'
import { useParam } from '@/lib/params'
import { useWriteOperational } from '@/lib/write'
import { generateSlots, slotStatus, currentTargetSlot, type Slot, type SlotStatus } from '@/lib/coldchain'
import type { BusinessDay, Equipment } from '@/lib/types'
import { ReadingEntryDialog } from './ReadingEntryDialog'

type EquipmentRow = Equipment & { id: string }
type UnitState = {
  equipment: EquipmentRow
  status: SlotStatus
  slot: Slot | null
  lastValueC: number | null
}

const STATUS_LABEL: Record<SlotStatus, string> = { due: 'Due', overdue: 'Overdue', missed: 'Missed', done: 'Done' }

export function TakeReadingsPage() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const intervalParam = useParam('equipment.temperature_reading_interval_minutes')
  const graceParam = useParam('equipment.reading_grace_minutes')
  const { write } = useWriteOperational()

  const [businessDay, setBusinessDay] = useState<BusinessDay | null>(null)
  const [units, setUnits] = useState<EquipmentRow[]>([])
  const [readingsBySlot, setReadingsBySlot] = useState<Map<string, Set<string>>>(new Map())
  const [lastValueByEquipment, setLastValueByEquipment] = useState<Map<string, number>>(new Map())
  const [now, setNow] = useState(new Date())
  const [selected, setSelected] = useState<EquipmentRow | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // businessDays/{id} is a single doc; filtered by document id since this
  // component already standardises on onSnapshot(query(...)) elsewhere.
  useEffect(() => {
    if (!businessDayId) return
    const unsub = onSnapshot(query(businessDaysCol, where('__name__', '==', businessDayId)), (snap) => {
      const d = snap.docs[0]
      setBusinessDay(d ? d.data() : null)
    })
    return unsub
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
    return onSnapshot(q, (snap) => {
      const bySlot = new Map<string, Set<string>>()
      const lastValue = new Map<string, number>()
      const lastReadAt = new Map<string, number>()
      snap.forEach((d) => {
        const r = d.data()
        if (r.scheduledSlot) {
          const set = bySlot.get(r.equipmentId) ?? new Set<string>()
          set.add(r.scheduledSlot)
          bySlot.set(r.equipmentId, set)
        }
        const readAtMs = r.readAt?.toMillis?.() ?? 0
        if (!lastReadAt.has(r.equipmentId) || readAtMs > (lastReadAt.get(r.equipmentId) ?? 0)) {
          lastReadAt.set(r.equipmentId, readAtMs)
          lastValue.set(r.equipmentId, r.valueC)
        }
      })
      setReadingsBySlot(bySlot)
      setLastValueByEquipment(lastValue)
    })
  }, [activeBranch, businessDayId])

  const slots = useMemo(() => {
    if (!businessDay || !intervalParam.isSet || typeof intervalParam.value !== 'number') return []
    return generateSlots(businessDay.opensAt.toDate(), businessDay.closesAt.toDate(), intervalParam.value)
  }, [businessDay, intervalParam])

  const graceMinutes = graceParam.isSet && typeof graceParam.value === 'number' ? graceParam.value : 45

  const unitStates: UnitState[] = units.map((equipment) => {
    const doneLabels = readingsBySlot.get(equipment.id) ?? new Set<string>()
    const slot = currentTargetSlot(slots, now, graceMinutes, doneLabels)
    const status: SlotStatus = slot ? slotStatus(slot, now, graceMinutes, doneLabels.has(slot.label)) : 'due'
    return { equipment, status, slot, lastValueC: lastValueByEquipment.get(equipment.id) ?? null }
  })

  // Missed-slot exceptions: raised once per unit+slot, client-side, on
  // whoever happens to view this screen after the slot lapses
  // (docs/04-M1-COLDCHAIN.md — "Server-side re-evaluation on sync catches
  // anything missed" covers the case nobody ever opens this screen; this
  // covers the common case immediately, offline-tolerant like everything
  // else here).
  useEffect(() => {
    if (!activeBranch || !businessDayId || slots.length === 0) return
    let cancelled = false
    async function raiseMissedExceptions() {
      for (const state of unitStates) {
        if (state.status !== 'missed' || !state.slot) continue
        const sourceId = `${state.equipment.id}::${businessDayId}::${state.slot.label}`
        const existing = await getDocs(
          query(exceptionsCol, where('branchId', '==', activeBranch!.branchId), where('sourceId', '==', sourceId)),
        )
        if (cancelled || !existing.empty) continue
        await write('exceptions', {
          source: 'temperature',
          sourceId,
          severity: 'medium',
          title: `${state.equipment.assetId} reading missed`,
          detail: `No reading recorded for the ${state.slot.label} slot.`,
          ownerRole: 'shift_leader',
          ownerId: null,
          dueAt: null,
          status: 'open',
          carriedForwardCount: 0,
          correctiveAction: null,
          lastCarriedForwardBusinessDayId: null,
        })
      }
    }
    raiseMissedExceptions()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranch, businessDayId, now, slots.length])

  return (
    <div className="readings-page">
      <h2>Take readings</h2>
      {unitStates.length === 0 && <p className="empty-state">No units need a temperature log.</p>}
      <div className="readings-grid">
        {unitStates.map((s) => (
          <button
            key={s.equipment.id}
            type="button"
            className={`reading-tile reading-tile--${s.status}`}
            onClick={() => setSelected(s.equipment)}
          >
            <span className="reading-tile__asset">{s.equipment.assetId}</span>
            <span className="reading-tile__zone">{s.equipment.zone}</span>
            <span className="reading-tile__status">{STATUS_LABEL[s.status]}</span>
            {s.lastValueC !== null && <span className="reading-tile__last">last: {s.lastValueC}°C</span>}
          </button>
        ))}
      </div>

      {selected && (
        <ReadingEntryDialog
          equipment={selected}
          slot={unitStates.find((s) => s.equipment.id === selected.id)?.slot ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
