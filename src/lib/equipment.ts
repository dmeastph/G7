// Equipment is master/reference data (docs/02-DATA-MODEL.md — no
// OperationalBase stamps in its shape), not an operational event. It goes
// through its own write path, not writeOperational(), the same way
// branches/roles/parameters do.
import { addDoc, doc, updateDoc, type UpdateData } from 'firebase/firestore'
import { equipmentCol } from './firebase'
import type { Equipment } from './types'

export async function createEquipment(data: Equipment): Promise<string> {
  const ref = await addDoc(equipmentCol, data)
  return ref.id
}

export async function updateEquipment(id: string, data: UpdateData<Equipment>): Promise<void> {
  await updateDoc(doc(equipmentCol, id), data)
}
