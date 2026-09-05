// Firebase wiring. Offline persistence is the reason Firestore was chosen at
// all (docs/01-ARCHITECTURE.md) — persistentLocalCache is not optional.
import { initializeApp } from 'firebase/app'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection,
  type CollectionReference,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
} from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import type {
  Branch,
  User,
  Role,
  Parameter,
  AuditLogEntry,
  BusinessDay,
  ShiftTemplate,
  ShiftInstance,
  Equipment,
  TemperatureReading,
  Excursion,
  QuarantineLot,
  MaintenanceTicket,
  ExceptionRecord,
  ChecklistTemplate,
  ChecklistRun,
  ChecklistResponse,
  QueueEscalation,
  WastageRecord,
  ReceivingRecord,
  TimeEntry,
  RosterAssignment,
  CashSession,
  CashDrop,
  CashCloseCount,
  CashRegisterException,
  IncidentRecord,
  CctvPreservation,
  ShiftHandover,
  DocumentRecord,
  DocumentAcknowledgment,
  DailySummary,
  LeaveRequest,
  TimeEntryDispute,
  ItemDoc,
  CatalogueSyncDoc,
} from './types'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const auth = getAuth(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

const usingEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true'
if (usingEmulators) {
  connectFirestoreEmulator(db, 'localhost', 8080)
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
  connectStorageEmulator(storage, 'localhost', 9199)
  connectFunctionsEmulator(functions, 'localhost', 5001)
}

// A converter that trusts documents to match T — Firestore's own type
// erasure means this is a boundary, not a runtime guarantee.
function converterFor<T extends object>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data: T) => data as Record<string, unknown>,
    fromFirestore: (snap: QueryDocumentSnapshot, options: SnapshotOptions) =>
      snap.data(options) as T,
  }
}

function typedCollection<T extends object>(path: string): CollectionReference<T> {
  return collection(db, path).withConverter(converterFor<T>())
}

export const branchesCol = typedCollection<Branch>('branches')
export const usersCol = typedCollection<User>('users')
export const rolesCol = typedCollection<Role>('roles')
export const parametersCol = typedCollection<Parameter>('parameters')
export const auditLogCol = typedCollection<AuditLogEntry>('auditLog')
export const businessDaysCol = typedCollection<BusinessDay>('businessDays')
export const shiftTemplatesCol = typedCollection<ShiftTemplate>('shiftTemplates')
export const shiftInstancesCol = typedCollection<ShiftInstance>('shiftInstances')

export const equipmentCol = typedCollection<Equipment>('equipment')
export const temperatureReadingsCol = typedCollection<TemperatureReading>('temperatureReadings')
export const excursionsCol = typedCollection<Excursion>('excursions')
export const quarantineLotsCol = typedCollection<QuarantineLot>('quarantineLots')
export const maintenanceTicketsCol = typedCollection<MaintenanceTicket>('maintenanceTickets')
export const exceptionsCol = typedCollection<ExceptionRecord>('exceptions')

export const checklistTemplatesCol = typedCollection<ChecklistTemplate>('checklistTemplates')
export const checklistRunsCol = typedCollection<ChecklistRun>('checklistRuns')
export const checklistResponsesCol = typedCollection<ChecklistResponse>('checklistResponses')
export const queueEscalationsCol = typedCollection<QueueEscalation>('queueEscalations')
export const wastageRecordsCol = typedCollection<WastageRecord>('wastageRecords')
export const receivingRecordsCol = typedCollection<ReceivingRecord>('receivingRecords')

export const timeEntriesCol = typedCollection<TimeEntry>('timeEntries')
export const rosterAssignmentsCol = typedCollection<RosterAssignment>('rosterAssignments')

export const cashSessionsCol = typedCollection<CashSession>('cashSessions')
export const cashDropsCol = typedCollection<CashDrop>('cashDrops')
export const cashCloseCountsCol = typedCollection<CashCloseCount>('cashCloseCounts')
export const cashRegisterExceptionsCol = typedCollection<CashRegisterException>('cashRegisterExceptions')

export const incidentRecordsCol = typedCollection<IncidentRecord>('incidentRecords')
export const cctvPreservationsCol = typedCollection<CctvPreservation>('cctvPreservations')

export const shiftHandoversCol = typedCollection<ShiftHandover>('shiftHandovers')

export const documentsCol = typedCollection<DocumentRecord>('documents')
export const documentAcknowledgmentsCol = typedCollection<DocumentAcknowledgment>('documentAcknowledgments')

export const dailySummariesCol = typedCollection<DailySummary>('dailySummaries')

export const leaveRequestsCol = typedCollection<LeaveRequest>('leaveRequests')
export const timeEntryDisputesCol = typedCollection<TimeEntryDispute>('timeEntryDisputes')

export const itemsCol = typedCollection<ItemDoc>('items')
export const catalogueSyncsCol = typedCollection<CatalogueSyncDoc>('catalogueSyncs')
