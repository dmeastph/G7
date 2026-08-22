// Asia/Manila wall-clock conversions — extracted from lib/businessDay.ts
// once lib/hours.ts (M3 night-differential) needed the same date math as
// business-day resolution (M0). Manila has a fixed UTC+8 offset with no
// DST, which is what makes these simple arithmetic instead of needing a
// timezone library.
const MANILA_UTC_OFFSET_HOURS = 8

export function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function shiftDateStrByDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** The wall-clock date and minutes-since-midnight in Asia/Manila for an
 *  instant, independent of the device's own timezone. */
export function manilaWallClock(instant: Date): { dateStr: string; minutesSinceMidnight: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  return { dateStr, minutesSinceMidnight: hour * 60 + Number(get('minute')) }
}

/** Convert a Manila wall-clock date + 'HH:MM' (including '24:00' for
 *  midnight) into the corresponding instant, as a UTC Date. */
export function manilaWallClockToInstant(dateStr: string, hhmm: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  let [hh, mm] = hhmm.split(':').map(Number)
  let day = d
  if (hh === 24) {
    hh = 0
    day += 1
  }
  return new Date(Date.UTC(y, m - 1, day, hh - MANILA_UTC_OFFSET_HOURS, mm))
}
