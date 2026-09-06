// Suppliers are master/reference data (docs/17-M12-SUPPLIERS.md — no
// OperationalBase stamps in its shape), not an operational event. Same
// write path as equipment/branches/roles/parameters, not writeOperational().
import { addDoc, doc, serverTimestamp, updateDoc, type UpdateData } from 'firebase/firestore'
import { suppliersCol } from './firebase'
import type { Supplier } from './types'

export async function createSupplier(data: Omit<Supplier, 'createdAt'>): Promise<string> {
  const ref = await addDoc(suppliersCol, { ...data, createdAt: serverTimestamp() } as Supplier)
  return ref.id
}

export async function updateSupplier(id: string, data: UpdateData<Supplier>): Promise<void> {
  await updateDoc(doc(suppliersCol, id), data)
}
