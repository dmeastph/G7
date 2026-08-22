// Money is stored as whole centavos, never floats — formatting is the only
// place a decimal point should appear (docs/01-ARCHITECTURE.md).
import type { Timestamp } from 'firebase/firestore'
import type { ParamDataType } from './types'

export function formatCentavos(centavos: number): string {
  const pesos = centavos / 100
  return `₱${pesos.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type Formattable = { value: number | string | boolean | null; dataType: ParamDataType | null }

export function formatParamValue(p: Formattable): string {
  if (p.value === null) return 'not set'
  switch (p.dataType) {
    case 'currency':
      return typeof p.value === 'number' ? formatCentavos(p.value) : String(p.value)
    case 'temperature_c':
      return `${p.value}°C`
    case 'duration_minutes':
      return `${p.value} min`
    case 'boolean':
      return p.value ? 'Yes' : 'No'
    default:
      return String(p.value)
  }
}

// A serverTimestamp()-stamped field reads back as `null` in the local,
// not-yet-acknowledged snapshot Firestore delivers the instant a write
// lands in cache — that snapshot is delivered synchronously, before any
// network round trip, so a live onSnapshot listener that's already
// mounted WILL observe it, not just "might on a slow connection". Treating
// it as "now" keeps sort order and elapsed-time math sane instead of
// crashing on a call to a method that doesn't exist on null. Never use
// this for a value the app itself decided (like `dueAt`, which is written
// as a concrete Timestamp.fromDate(), never a pending sentinel).
export function toMillisSafe(ts: Timestamp | null | undefined): number {
  return ts ? ts.toMillis() : Date.now()
}

/** Same reasoning as toMillisSafe, for call sites that need a Date. */
export function toDateSafe(ts: Timestamp | null | undefined): Date {
  return ts ? ts.toDate() : new Date()
}

// Both accept null/undefined — a serverTimestamp()-stamped field reads
// back as null until the write is acknowledged (see toMillisSafe above),
// and callers pass fields like `readAt`/`startedAt` here often enough
// that guarding it once here beats remembering it at every call site.
export function formatTimeManila(ts: Timestamp | Date | null | undefined): string {
  const d = ts instanceof Date ? ts : toDateSafe(ts)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export function formatMinutesSince(ts: Timestamp | Date | null | undefined, now: Date = new Date()): string {
  const d = ts instanceof Date ? ts : toDateSafe(ts)
  const minutes = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return `${hours}h ${rem}m ago`
}
