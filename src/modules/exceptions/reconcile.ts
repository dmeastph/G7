// Carry-forward escalation — docs/07-M2-CHECKLISTS.md "completing" the
// exception engine. Client-triggered on viewing the inbox, same honest
// limitation as M1's missed-reading detection: a scheduled Cloud Function
// would catch this even if nobody opens the app, and that's out of scope
// here.
import { getDocs, query, updateDoc, where } from 'firebase/firestore'
import { exceptionsCol } from '@/lib/firebase'

/** Any exception still open/in_progress, not yet counted for today,
 *  gets carriedForwardCount bumped once; at 3 it's reassigned to the store
 *  manager and marked escalated (docs/02-DATA-MODEL.md:
 *  "carriedForwardCount: 3 or more escalates to the Store Manager").
 *  `lastCarriedForwardBusinessDayId` (falling back to `businessDayId` for
 *  an exception never reconciled yet) makes repeat inbox views on the same
 *  day a no-op instead of over-counting. */
export async function reconcileCarriedForwardExceptions(branchId: string, todayBusinessDayId: string): Promise<void> {
  const snap = await getDocs(
    query(exceptionsCol, where('branchId', '==', branchId), where('status', 'in', ['open', 'in_progress'])),
  )
  for (const d of snap.docs) {
    const data = d.data()
    const lastCounted = data.lastCarriedForwardBusinessDayId ?? data.businessDayId
    if (lastCounted === todayBusinessDayId) continue

    const carriedForwardCount = data.carriedForwardCount + 1
    const escalate = carriedForwardCount >= 3
    await updateDoc(d.ref, {
      carriedForwardCount,
      lastCarriedForwardBusinessDayId: todayBusinessDayId,
      ...(escalate ? { ownerRole: 'store_manager', status: 'escalated' } : {}),
    })
  }
}
