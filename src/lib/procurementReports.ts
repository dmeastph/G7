// docs/21-M16-PROCUREMENT-REPORTS.md — pure functions over already-
// subscribed data, same shape g7-pos/src/lib/salesReports.ts and its
// siblings already use: no Firestore access in here, just arrays in,
// an aggregated shape out, so each dimension is unit-testable without a
// live database (the same reasoning catalogueSync.ts, M10, was split out
// as pure diff logic for).
import { toMillisSafe } from './format'
import type { ItemDoc, PurchaseOrder } from './types'

const OPEN_STATUSES = new Set(['draft', 'sent', 'confirmed', 'partially_received'])
// A 'draft' order isn't a commitment yet — nothing's been sent to the
// supplier. A 'cancelled' one never was.
const SPEND_STATUSES = new Set(['sent', 'confirmed', 'partially_received', 'received'])

export type AgingBucket = '0-7 days' | '8-14 days' | '15-30 days' | '30+ days'

export type OpenOrderAging = {
  poId: string
  supplierName: string
  status: string
  daysOpen: number
  bucket: AgingBucket
}

function agingBucket(days: number): AgingBucket {
  if (days <= 7) return '0-7 days'
  if (days <= 14) return '8-14 days'
  if (days <= 30) return '15-30 days'
  return '30+ days'
}

export function computeOpenOrderAging(orders: (PurchaseOrder & { id: string })[], now = Date.now()): OpenOrderAging[] {
  return orders
    .filter((po) => OPEN_STATUSES.has(po.status))
    .map((po) => {
      const daysOpen = Math.floor((now - toMillisSafe(po.createdAt)) / (24 * 60 * 60 * 1000))
      return { poId: po.id, supplierName: po.supplierName, status: po.status, daysOpen, bucket: agingBucket(daysOpen) }
    })
    .sort((a, b) => b.daysOpen - a.daysOpen)
}

export type SpendBySupplier = { supplierName: string; totalCentavos: number }
export type SpendByCategory = { category: string; totalCentavos: number }
export type SpendByMonth = { month: string; totalCentavos: number } // month: YYYY-MM

export type SpendReport = {
  grandTotalCentavos: number
  bySupplier: SpendBySupplier[]
  byCategory: SpendByCategory[]
  byMonth: SpendByMonth[]
}

/** Category comes from `items`' *current* category, not a snapshot at
 *  order time — see docs/21-M16-PROCUREMENT-REPORTS.md's own note on why
 *  that's a deliberate, documented simplification rather than an oversight. */
export function computeSpend(orders: (PurchaseOrder & { id: string })[], items: (ItemDoc & { id: string })[]): SpendReport {
  const categoryByItemId = new Map(items.map((i) => [i.id, i.category]))
  const committed = orders.filter((po) => SPEND_STATUSES.has(po.status))

  const bySupplierMap = new Map<string, number>()
  const byCategoryMap = new Map<string, number>()
  const byMonthMap = new Map<string, number>()
  let grandTotalCentavos = 0

  for (const po of committed) {
    grandTotalCentavos += po.totalCentavos
    bySupplierMap.set(po.supplierName, (bySupplierMap.get(po.supplierName) ?? 0) + po.totalCentavos)

    const month = new Date(toMillisSafe(po.createdAt)).toISOString().slice(0, 7)
    byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + po.totalCentavos)

    for (const line of po.lines) {
      const lineCentavos = line.qtyOrdered * line.unitCostCentavos
      const category = categoryByItemId.get(line.itemId) ?? 'Uncategorized'
      byCategoryMap.set(category, (byCategoryMap.get(category) ?? 0) + lineCentavos)
    }
  }

  return {
    grandTotalCentavos,
    bySupplier: [...bySupplierMap.entries()].map(([supplierName, totalCentavos]) => ({ supplierName, totalCentavos })).sort((a, b) => b.totalCentavos - a.totalCentavos),
    byCategory: [...byCategoryMap.entries()].map(([category, totalCentavos]) => ({ category, totalCentavos })).sort((a, b) => b.totalCentavos - a.totalCentavos),
    byMonth: [...byMonthMap.entries()].map(([month, totalCentavos]) => ({ month, totalCentavos })).sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export type OnTimeDelivery = { supplierName: string; onTimeCount: number; totalCount: number; onTimePercent: number }

/** Only orders carrying both dates count — see docs/21-M16-PROCUREMENT-
 *  REPORTS.md: a missing promise is not a broken one. */
export function computeOnTimeDelivery(orders: (PurchaseOrder & { id: string })[]): OnTimeDelivery[] {
  const bySupplier = new Map<string, { onTime: number; total: number }>()

  for (const po of orders) {
    if (!po.expectedDeliveryDate || !po.receivedAt) continue
    const receivedDate = new Date(toMillisSafe(po.receivedAt)).toISOString().slice(0, 10)
    const onTime = receivedDate <= po.expectedDeliveryDate
    const entry = bySupplier.get(po.supplierName) ?? { onTime: 0, total: 0 }
    entry.total += 1
    if (onTime) entry.onTime += 1
    bySupplier.set(po.supplierName, entry)
  }

  return [...bySupplier.entries()]
    .map(([supplierName, { onTime, total }]) => ({
      supplierName,
      onTimeCount: onTime,
      totalCount: total,
      onTimePercent: Math.round((onTime / total) * 100),
    }))
    .sort((a, b) => b.totalCount - a.totalCount)
}

export type LowStockItem = { id: string; name: string; qtyOnHand: number; reorderPoint: number }

/** The one place this filter lives — DashboardPage's own low-stock card
 *  (M11) imports this too, so the two can never silently drift apart
 *  (docs/21-M16-PROCUREMENT-REPORTS.md acceptance criteria). An item with
 *  no reorderPoint set is never flagged — silence means "not configured,"
 *  not "fine." */
export function computeLowStockItems(items: (ItemDoc & { id: string })[]): LowStockItem[] {
  return items
    .filter((i): i is ItemDoc & { id: string; reorderPoint: number } => i.reorderPoint !== null && i.qtyOnHand <= i.reorderPoint)
    .map((i) => ({ id: i.id, name: i.name, qtyOnHand: i.qtyOnHand, reorderPoint: i.reorderPoint }))
}
