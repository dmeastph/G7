// docs/19-M14-PURCHASE-ORDERS.md — creating a PO both writes the order and,
// when it came from a request, links that request back to it — two writes,
// not a transaction, the same eventually-consistent posture M11's
// movement-then-qtyOnHand chain already takes for a non-financial-critical
// path. Status/lines edits after creation are direct updates, enforced by
// firestore.rules' own isValidPoStatusTransition + affectedKeys() check.
import { doc, updateDoc, type UpdateData } from 'firebase/firestore'
import { purchaseOrdersCol, purchaseRequestsCol } from './firebase'
import { useWriteOperational } from './write'
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from './types'

export function usePurchaseOrderActions() {
  const { write } = useWriteOperational()

  async function createPurchaseOrder(input: {
    supplierId: string
    supplierName: string
    lines: PurchaseOrderLine[]
    sourcePurchaseRequestId: string | null
  }): Promise<string> {
    const totalCentavos = input.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitCostCentavos, 0)
    const poId = await write('purchaseOrders', {
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      lines: input.lines,
      totalCentavos,
      status: 'draft',
      sourcePurchaseRequestId: input.sourcePurchaseRequestId,
      cancelledReason: null,
    })
    if (input.sourcePurchaseRequestId) {
      await updateDoc(doc(purchaseRequestsCol, input.sourcePurchaseRequestId), { linkedPurchaseOrderId: poId })
    }
    return poId
  }

  return { createPurchaseOrder }
}

/** Only valid while the order is still 'draft' — firestore.rules rejects
 *  this call once status has moved on. */
export async function updateDraftPurchaseOrder(
  id: string,
  patch: { supplierId: string; supplierName: string; lines: PurchaseOrderLine[] },
): Promise<void> {
  const totalCentavos = patch.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitCostCentavos, 0)
  await updateDoc(doc(purchaseOrdersCol, id), { ...patch, totalCentavos } as UpdateData<PurchaseOrder>)
}

export async function advancePurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
  await updateDoc(doc(purchaseOrdersCol, id), { status })
}

export async function cancelPurchaseOrder(id: string, reason: string): Promise<void> {
  await updateDoc(doc(purchaseOrdersCol, id), { status: 'cancelled', cancelledReason: reason })
}
