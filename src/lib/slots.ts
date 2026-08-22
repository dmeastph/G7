// Shared scheduling logic — originally written for M1 temperature readings
// (docs/04-M1-COLDCHAIN.md), reused as-is by M2 checklist runs
// (docs/07-M2-CHECKLISTS.md: "literally the same generateSlots/slotStatus
// functions"). Domain-agnostic on purpose: it only knows about time
// windows and intervals, never about equipment or checklists.
export type SlotStatus = 'due' | 'overdue' | 'missed' | 'done'

export type Slot = {
  label: string // '06:00' — the wall-clock slot start, Manila time
  start: Date
  end: Date // next slot's start, or the window's close for the last slot
}

function manilaHHMM(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant)
}

/** One slot per `intervalMinutes` from `start` to `end`. Pass the whole
 *  window (e.g. business-day open to close) as a single slot by setting
 *  `intervalMinutes` to a value >= the window length — used for opening
 *  and closing checklists, which are one run per business day, not
 *  interval-repeated. */
export function generateSlots(start: Date, end: Date, intervalMinutes: number): Slot[] {
  if (intervalMinutes <= 0) return []
  const slots: Slot[] = []
  let cursor = new Date(start)
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + intervalMinutes * 60_000, end.getTime()))
    slots.push({ label: manilaHHMM(cursor), start: new Date(cursor), end: next })
    cursor = next
  }
  return slots
}

/** due -> overdue after the grace period -> missed once the slot's own
 *  window ends. `done` wins regardless of timing once an entry exists. */
export function slotStatus(slot: Slot, now: Date, graceMinutes: number, completed: boolean): SlotStatus {
  if (completed) return 'done'
  if (now < slot.start) return 'due' // not literally due yet, but nothing earlier to show
  const graceEnds = new Date(slot.start.getTime() + graceMinutes * 60_000)
  if (now < graceEnds) return 'due'
  if (now < slot.end) return 'overdue'
  return 'missed'
}

/** The slot an entry made right now should be attributed to: the earliest
 *  slot that is due/overdue and not yet done. Falls back to the most
 *  recent past slot (ad-hoc entry, nothing currently due) or null (no
 *  slots have started yet). Never pre-fills a value — callers use this
 *  only for the slot label. */
export function currentTargetSlot(slots: Slot[], now: Date, graceMinutes: number, doneLabels: Set<string>): Slot | null {
  const openSlots = slots.filter((s) => now >= s.start)
  if (openSlots.length === 0) return null
  const needsEntry = openSlots.find((s) => {
    const status = slotStatus(s, now, graceMinutes, doneLabels.has(s.label))
    return status === 'due' || status === 'overdue'
  })
  return needsEntry ?? openSlots[openSlots.length - 1]
}
