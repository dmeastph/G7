// Pure diff logic for the item master bridge (docs/15-M10-ITEM-MASTER.md).
// No Firestore, no fetch — those live in index.ts, which is what actually
// needs Admin SDK access. Kept separate and pure so the matching rules can
// be tested directly against fixtures, the same separation g7-pos's own
// functions/src/contiguity.ts already uses for the same reason.

export type FetchedItem = {
  itemId: string // g7-pos's own document ID — the join key
  sku: string
  barcode: string | null
  name: string
  category: string
  priceCentavos: number
  vatClass: string
}

export type ExistingItem = {
  sourceItemId: string
  sku: string
  barcode: string | null
  name: string
  category: string
  priceCentavos: number
  vatClass: string
  presentInLatestExport: boolean
}

export type CatalogueDiff = {
  newItems: FetchedItem[]
  changedItems: FetchedItem[]
  missingSourceItemIds: string[]
}

const SYNCED_FIELDS = ['name', 'category', 'priceCentavos', 'vatClass', 'barcode'] as const

function isChanged(fetched: FetchedItem, existing: ExistingItem): boolean {
  return SYNCED_FIELDS.some((field) => fetched[field] !== existing[field])
}

/** New: fetched but not in g7-ops yet. Changed: in both, any synced field
 *  differs. Missing: in g7-ops (and still marked present), not in the
 *  fetch — flagged by the caller, never deleted here or anywhere else. */
export function computeCatalogueDiff(fetched: FetchedItem[], existing: ExistingItem[]): CatalogueDiff {
  const existingById = new Map(existing.map((e) => [e.sourceItemId, e]))
  const fetchedIds = new Set(fetched.map((f) => f.itemId))

  const newItems: FetchedItem[] = []
  const changedItems: FetchedItem[] = []
  for (const item of fetched) {
    const match = existingById.get(item.itemId)
    if (!match) {
      newItems.push(item)
    } else if (isChanged(item, match)) {
      changedItems.push(item)
    }
  }

  const missingSourceItemIds = existing.filter((e) => e.presentInLatestExport && !fetchedIds.has(e.sourceItemId)).map((e) => e.sourceItemId)

  return { newItems, changedItems, missingSourceItemIds }
}
