// Deciding a request is a manager-only update to the same document — same
// shape as decideLeave in modules/selfservice/actions.ts
// (docs/18-M13-PURCHASE-REQUESTS.md).
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { purchaseRequestsCol } from './firebase'

export async function decidePurchaseRequest(
  requestId: string,
  decision: 'approved' | 'denied',
  decidedById: string,
  decidedByName: string,
  note: string,
): Promise<void> {
  await updateDoc(doc(purchaseRequestsCol, requestId), {
    status: decision,
    decidedBy: decidedById,
    decidedByName,
    decidedAt: serverTimestamp(),
    decisionNote: note,
  })
}
