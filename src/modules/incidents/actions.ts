// The business logic behind incident capture — report (with a linked
// exception raised automatically), CCTV preservation, escalation, closure.
// Built on useWriteOperational() so every write here still gets the five
// stamps and an audit entry for free (docs/01-ARCHITECTURE.md rule 1).
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
import { exceptionsCol, incidentRecordsCol } from '@/lib/firebase'
import { useWriteOperational } from '@/lib/write'
import type { IncidentRecord, IncidentType } from '@/lib/types'

export function useIncidentActions() {
  const { write } = useWriteOperational()

  /** Creates the incident and its linked exception together — an incident
   *  is visible in the Exceptions Inbox from the moment it's typed, not
   *  after some later escalation step (docs/10-M5-INCIDENTS.md §1). */
  async function reportIncident(input: {
    type: IncidentType
    severity: IncidentRecord['severity']
    occurredAt: Date
    narrative: string
    immediateAction: string
  }): Promise<string> {
    const incidentId = await write('incidentRecords', {
      type: input.type,
      severity: input.severity,
      occurredAt: Timestamp.fromDate(input.occurredAt),
      narrative: input.narrative,
      immediateAction: input.immediateAction,
      status: 'open',
      exceptionId: null,
      rootCause: '',
      closedBy: null,
      closedAt: null,
    })

    const exceptionId = await write('exceptions', {
      source: 'incident',
      sourceId: incidentId,
      severity: input.severity,
      title: `Incident reported — ${input.type}`,
      detail: input.narrative,
      ownerRole: 'shift_leader',
      ownerId: null,
      dueAt: null,
      status: 'open',
      carriedForwardCount: 0,
      correctiveAction: null,
      lastCarriedForwardBusinessDayId: null,
    })
    await updateDoc(doc(incidentRecordsCol, incidentId), { exceptionId })

    return incidentId
  }

  async function preserveClip(
    incidentId: string,
    input: { cameras: string[]; rangeStart: Date; rangeEnd: Date; clipRef: string; retainUntil: Date },
  ): Promise<string> {
    return write('cctvPreservations', {
      incidentId,
      cameras: input.cameras,
      rangeStart: Timestamp.fromDate(input.rangeStart),
      rangeEnd: Timestamp.fromDate(input.rangeEnd),
      clipRef: input.clipRef,
      retainUntil: Timestamp.fromDate(input.retainUntil),
    })
  }

  /** Same shape as M1's escalateToQuarantine — bump the incident and its
   *  linked exception together (docs/10-M5-INCIDENTS.md §2). */
  async function escalate(incident: IncidentRecord & { id: string }): Promise<void> {
    await updateDoc(doc(incidentRecordsCol, incident.id), { status: 'escalated' })
    if (incident.exceptionId) {
      await updateDoc(doc(exceptionsCol, incident.exceptionId), { severity: 'critical', status: 'escalated' })
    }
  }

  async function closeIncident(incidentId: string, rootCause: string, closedByName: string): Promise<void> {
    await updateDoc(doc(incidentRecordsCol, incidentId), {
      status: 'closed',
      rootCause,
      closedBy: closedByName,
      closedAt: serverTimestamp(),
    })
  }

  return { reportIncident, preserveClip, escalate, closeIncident }
}
