// The business logic behind shift handover — generating the frozen pack
// (docs/11-M6-SHIFT-HANDOVER.md "Generating a pack"), and acceptance. Built
// on useWriteOperational() so the handover write itself still gets the
// five stamps and an audit entry for free (docs/01-ARCHITECTURE.md rule 1).
import { doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import {
  cashSessionsCol,
  checklistRunsCol,
  exceptionsCol,
  incidentRecordsCol,
  maintenanceTicketsCol,
  shiftHandoversCol,
} from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import { useActiveBranch } from '@/lib/branch'
import { useCurrentBusinessDayId, useCurrentShift } from '@/lib/businessDay'
import type { HandoverPackExceptionItem } from '@/lib/types'

export function useHandoverActions() {
  const { write } = useWriteOperational()
  const activeBranch = useActiveBranch()
  const currentShift = useCurrentShift()
  const businessDayId = useCurrentBusinessDayId()

  /** Reuses an existing handover for the current shift instance rather than
   *  creating a second one — same "reuse, don't duplicate" rule M4 uses for
   *  cash sessions (docs/11-M6-SHIFT-HANDOVER.md "Generating a pack"). */
  async function generateHandover(): Promise<string> {
    if (!activeBranch) throw new Error('No active branch resolved yet.')
    if (!currentShift) throw new Error('No current shift resolved — nothing to generate a handover for.')
    if (!businessDayId) throw new Error('No business day resolved yet.')

    const existing = await getDocs(
      query(
        shiftHandoversCol,
        where('branchId', '==', activeBranch.branchId),
        where('shiftInstanceId', '==', currentShift.id),
      ),
    )
    if (!existing.empty) return existing.docs[0].id

    // The two immediately preceding handovers for this branch — the only
    // history this module reads, for the carry-forward computation. Not
    // M2's exceptions.carriedForwardCount, deliberately (see spec).
    const priorSnap = await getDocs(
      query(shiftHandoversCol, where('branchId', '==', activeBranch.branchId), orderBy('createdAt', 'desc'), limit(2)),
    )
    const priors = priorSnap.docs.map((d) => d.data())

    const [exceptionsSnap, incidentsSnap, ticketsSnap, cashSnap, checklistSnap] = await Promise.all([
      getDocs(
        query(
          exceptionsCol,
          where('branchId', '==', activeBranch.branchId),
          where('status', 'in', ['open', 'in_progress', 'escalated']),
        ),
      ),
      getDocs(
        query(
          incidentRecordsCol,
          where('branchId', '==', activeBranch.branchId),
          where('status', 'in', ['open', 'escalated']),
        ),
      ),
      getDocs(
        query(
          maintenanceTicketsCol,
          where('branchId', '==', activeBranch.branchId),
          where('status', 'in', ['open', 'attended']),
        ),
      ),
      getDocs(query(cashSessionsCol, where('branchId', '==', activeBranch.branchId), where('status', '==', 'open'))),
      getDocs(query(checklistRunsCol, where('branchId', '==', activeBranch.branchId), where('businessDayId', '==', businessDayId))),
    ])

    const openExceptions: HandoverPackExceptionItem[] = exceptionsSnap.docs.map((d) => {
      const data = d.data()
      let carriedShiftCount = 1
      for (const prior of priors) {
        if (prior.pack.openExceptions.some((item) => item.exceptionId === d.id)) carriedShiftCount++
        else break
      }
      return { exceptionId: d.id, title: data.title, severity: data.severity, source: data.source, carriedShiftCount }
    })

    let checklistsCompletedToday = 0
    let checklistsMissedToday = 0
    checklistSnap.forEach((d) => {
      const status = d.data().status
      if (status === 'completed') checklistsCompletedToday++
      else if (status === 'missed') checklistsMissedToday++
    })

    const handoverId = await write('shiftHandovers', {
      shiftInstanceId: currentShift.id,
      pack: {
        generatedAt: serverTimestamp(),
        openExceptions,
        openIncidentCount: incidentsSnap.size,
        openTicketCount: ticketsSnap.size,
        cashSessionsStillOpen: cashSnap.size,
        checklistsCompletedToday,
        checklistsMissedToday,
      },
      status: 'pending',
      acceptedBy: null,
      acceptedByName: null,
      acceptedAt: null,
      incomingNote: '',
    })

    // Automatic escalation after three consecutive shifts — the side
    // effect this whole carry-forward computation exists for.
    for (const item of openExceptions) {
      if (item.carriedShiftCount >= 3) {
        await updateDoc(doc(exceptionsCol, item.exceptionId), { severity: 'critical', status: 'escalated' })
      }
    }

    return handoverId
  }

  async function acceptHandover(handoverId: string, note: string, acceptedById: string, acceptedByName: string): Promise<void> {
    await updateDoc(doc(shiftHandoversCol, handoverId), {
      status: 'accepted',
      acceptedBy: acceptedById,
      acceptedByName,
      acceptedAt: serverTimestamp(),
      incomingNote: note,
    })
  }

  return { generateHandover, acceptHandover }
}
