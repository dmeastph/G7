// Worked-hours computation — docs/08-M3-TIME-ROSTER-CERTIFICATION.md
// "Hours — computed, not stored". Pure functions over raw timeEntries, the
// same "derive at view time" reasoning as M1's slot status.
import { manilaWallClock, manilaWallClockToInstant, shiftDateStrByDays } from './manila'
import { toMillisSafe, toDateSafe } from './format'
import type { TimeEntry } from './types'

export type Interval = { start: Date; end: Date }

/** Pairs clock_in with the next clock_out. An unmatched trailing clock_in
 *  (still clocked in) is dropped — there's no "end" to report yet. */
export function pairClockEvents(entries: TimeEntry[]): Interval[] {
  return pairByType(entries, 'clock_in', 'clock_out')
}

export function pairBreaks(entries: TimeEntry[]): Interval[] {
  return pairByType(entries, 'break_start', 'break_end')
}

function pairByType(entries: TimeEntry[], startType: TimeEntry['type'], endType: TimeEntry['type']): Interval[] {
  const sorted = [...entries]
    .filter((e) => e.type === startType || e.type === endType)
    .sort((a, b) => toMillisSafe(a.at) - toMillisSafe(b.at))
  const intervals: Interval[] = []
  let openStart: Date | null = null
  for (const e of sorted) {
    if (e.type === startType) {
      openStart ??= toDateSafe(e.at)
    } else if (openStart !== null) {
      intervals.push({ start: openStart, end: toDateSafe(e.at) })
      openStart = null
    }
  }
  return intervals
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60_000)
}

function overlapMinutes(a: Interval, b: Interval): number {
  const start = Math.max(a.start.getTime(), b.start.getTime())
  const end = Math.min(a.end.getTime(), b.end.getTime())
  return end > start ? (end - start) / 60_000 : 0
}

/** Total worked minutes for one clock-in/out interval, minus any break
 *  minutes that fall inside it. */
export function workedMinutes(clockInterval: Interval, breaks: Interval[]): number {
  const total = minutesBetween(clockInterval.start, clockInterval.end)
  const breakMinutes = breaks.reduce((sum, b) => sum + overlapMinutes(clockInterval, b), 0)
  return Math.max(0, total - breakMinutes)
}

/** Minutes of `interval` that fall inside the night-differential window
 *  (nightStartHHMM to nightEndHHMM, wrapping midnight) — computed per
 *  Manila calendar day the interval touches, not a flat UTC offset. */
export function nightDifferentialMinutes(interval: Interval, nightStartHHMM: string, nightEndHHMM: string): number {
  if (interval.end <= interval.start) return 0

  let total = 0
  let dateStr = manilaWallClock(interval.start).dateStr
  const lastDateStr = manilaWallClock(new Date(interval.end.getTime() - 1)).dateStr

  for (let guard = 0; guard < 4; guard++) {
    const nightStart = manilaWallClockToInstant(dateStr, nightStartHHMM)
    const nightEnd = manilaWallClockToInstant(shiftDateStrByDays(dateStr, 1), nightEndHHMM)
    total += overlapMinutes(interval, { start: nightStart, end: nightEnd })
    if (dateStr === lastDateStr) break
    dateStr = shiftDateStrByDays(dateStr, 1)
  }
  return Math.round(total)
}

export type ShiftHoursSummary = {
  clockInterval: Interval
  totalMinutes: number
  breakMinutes: number
  nightDifferentialMinutes: number
  regularMinutes: number
}

/** One summary per clock-in/out pair for the day — a person clocking in
 *  and out more than once (e.g. split shift) gets one row per attendance,
 *  not merged into a single total (docs/08-M3-TIME-ROSTER-CERTIFICATION.md
 *  "actual-vs-rostered"). */
export function summarizeShifts(entries: TimeEntry[], nightStartHHMM: string, nightEndHHMM: string): ShiftHoursSummary[] {
  const clockIntervals = pairClockEvents(entries)
  const breaks = pairBreaks(entries)
  return clockIntervals.map((clockInterval) => {
    const relevantBreaks = breaks.filter((b) => overlapMinutes(clockInterval, b) > 0)
    const breakMinutes = relevantBreaks.reduce((sum, b) => sum + overlapMinutes(clockInterval, b), 0)
    const total = workedMinutes(clockInterval, breaks)
    const nightMinutes = Math.min(total, nightDifferentialMinutes(clockInterval, nightStartHHMM, nightEndHHMM))
    return {
      clockInterval,
      totalMinutes: total,
      breakMinutes,
      nightDifferentialMinutes: nightMinutes,
      regularMinutes: Math.max(0, total - nightMinutes),
    }
  })
}
