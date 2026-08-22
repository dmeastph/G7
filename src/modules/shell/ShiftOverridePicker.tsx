// "A manager can override the resolved shift" (docs/03-M0-FOUNDATION.md
// acceptance criteria) — an escape hatch for when automatic resolution is
// wrong, not a scheduling tool.
import { useEffect, useState } from 'react'
import { getDocs, query, where } from 'firebase/firestore'
import { shiftInstancesCol } from '@/lib/firebase'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId, setShiftOverride, type ResolvedShift } from '@/lib/businessDay'

export function ShiftOverridePicker() {
  const activeBranch = useActiveBranch()
  const businessDayId = useCurrentBusinessDayId()
  const [options, setOptions] = useState<ResolvedShift[]>([])

  useEffect(() => {
    if (!activeBranch || !businessDayId) return
    getDocs(query(shiftInstancesCol, where('businessDayId', '==', businessDayId), where('branchId', '==', activeBranch.branchId))).then(
      (snap) => setOptions(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    )
  }, [activeBranch, businessDayId])

  if (options.length === 0) return null

  return (
    <label>
      Override shift:{' '}
      <select defaultValue="" onChange={(e) => setShiftOverride(e.target.value || null)}>
        <option value="">Automatic</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.templateName}
          </option>
        ))}
      </select>
    </label>
  )
}
