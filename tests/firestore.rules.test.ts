// Rules tests required by docs/03-M0-FOUNDATION.md acceptance criteria:
// non-manager can't touch parameters, nobody can update/delete an audit
// entry, a station account can't read another branch. Run against the
// Firestore emulator: `npm run emulators` in one terminal, this in another
// (or `npm run test:rules` once the emulator is already running).
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-g7-ops-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: 'localhost', port: 8080 },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

const managerCtx = () => testEnv.authenticatedContext('manager-uid', { role: 'store_manager', branchId: '001' })
const ownerCtx = () => testEnv.authenticatedContext('owner-uid', { role: 'owner', branchId: '001' })
const stationCtx = () => testEnv.authenticatedContext('station-001', { role: 'station', branchId: '001' })
const stationOtherBranchCtx = () => testEnv.authenticatedContext('station-002', { role: 'station', branchId: '002' })
const staffCtx = () => testEnv.authenticatedContext('cashier-uid', { role: 'cashier', branchId: '001' })

describe('branches', () => {
  test('an owner can update a branch; a store_manager cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'branches/001'), {
        code: '001', name: 'Imus', operatingMode: 'scheduled', openTime: '06:00', closeTime: '24:00',
        businessDayCutoff: '24:00', timezone: 'Asia/Manila', address: 'Imus, Cavite', status: 'active',
      })
    })

    await assertFails(updateDoc(doc(managerCtx().firestore(), 'branches/001'), { status: 'closed' }))
    await assertSucceeds(updateDoc(doc(ownerCtx().firestore(), 'branches/001'), { status: 'closed' }))
  })
})

describe('parameters', () => {
  test('a manager can create a parameter', async () => {
    const db = managerCtx().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'parameters/p1'), {
        key: 'cash.drawer_max_balance',
        scope: 'global',
        scopeId: null,
        value: 300000,
        dataType: 'currency',
        minAllowed: 100000,
        maxAllowed: 1000000,
        unit: 'PHP_centavos',
        ownerRole: 'owner',
        effectiveFrom: new Date(),
        effectiveTo: null,
        changedBy: 'manager-uid',
        changedAt: new Date(),
        reason: 'test',
        requiresProfessionalSignoff: false,
      }),
    )
  })

  test('a non-manager cannot write a parameter, even bypassing the UI', async () => {
    const db = staffCtx().firestore()
    await assertFails(
      setDoc(doc(db, 'parameters/p2'), {
        key: 'cash.drawer_max_balance',
        scope: 'global',
        scopeId: null,
        value: 999999,
        dataType: 'currency',
        minAllowed: null,
        maxAllowed: null,
        unit: null,
        ownerRole: 'owner',
        effectiveFrom: new Date(),
        effectiveTo: null,
        changedBy: 'cashier-uid',
        changedAt: new Date(),
        reason: 'trying anyway',
        requiresProfessionalSignoff: false,
      }),
    )
  })

  test('a station account cannot write a parameter', async () => {
    const db = stationCtx().firestore()
    await assertFails(setDoc(doc(db, 'parameters/p3'), { key: 'x', scope: 'global', scopeId: null, value: 1 }))
  })
})

describe('auditLog — append only', () => {
  test('a signed-in user can create a valid audit entry', async () => {
    const db = staffCtx().firestore()
    await assertSucceeds(
      addDoc(collection(db, 'auditLog'), {
        entity: 'testWrites',
        entityId: 'x1',
        action: 'create',
        before: null,
        after: { note: 'hi' },
        actorId: 'cashier-uid',
        actorName: 'Test Cashier',
        at: serverTimestamp(),
        deviceId: 'device-1',
        branchId: '001',
      }),
    )
  })

  // Seeding goes through withSecurityRulesDisabled, not an authenticated
  // context: the create rule requires `at == request.time` (an exact
  // server-timestamp match), which a client-supplied Date can never satisfy
  // — that's the point of the rule, but it means normal authenticated
  // writes can't be used to set up these fixtures either.
  test('nobody can update an audit entry, including a manager', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditLog/entry-1'), {
        entity: 'x', entityId: 'x', action: 'create', before: null, after: null,
        actorId: 'owner-uid', actorName: 'Owner', at: new Date(), deviceId: 'd', branchId: '001',
      })
    })

    const db = managerCtx().firestore()
    await assertFails(updateDoc(doc(db, 'auditLog/entry-1'), { action: 'close' }))
  })

  test('nobody can delete an audit entry, including a manager', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditLog/entry-2'), {
        entity: 'x', entityId: 'x', action: 'create', before: null, after: null,
        actorId: 'owner-uid', actorName: 'Owner', at: new Date(), deviceId: 'd', branchId: '001',
      })
    })

    const db = managerCtx().firestore()
    await assertFails(deleteDoc(doc(db, 'auditLog/entry-2')))
  })

  test('only a manager can read auditLog', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditLog/entry-3'), {
        entity: 'x', entityId: 'x', action: 'create', before: null, after: null,
        actorId: 'owner-uid', actorName: 'Owner', at: new Date(), deviceId: 'd', branchId: '001',
      })
    })

    await assertFails(getDoc(doc(staffCtx().firestore(), 'auditLog/entry-3')))
    await assertSucceeds(getDoc(doc(managerCtx().firestore(), 'auditLog/entry-3')))
  })
})

describe('multi-branch safety', () => {
  test("a station account cannot read another branch's user record", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/staff-001'), {
        employeeNo: 'E001', displayName: 'Staff One', roles: ['cashier'], branchIds: ['001'],
        pinHash: 'x', authUid: null, status: 'active', certifications: {}, hiredAt: new Date(), createdAt: new Date(),
      })
    })

    await assertSucceeds(getDoc(doc(stationCtx().firestore(), 'users/staff-001')))
    await assertFails(getDoc(doc(stationOtherBranchCtx().firestore(), 'users/staff-001')))
  })

  test('operational writes are rejected for a mismatched branchId', async () => {
    const db = stationCtx().firestore()
    await assertFails(
      setDoc(doc(db, 'businessDays/002_2026-01-01'), {
        branchId: '002',
        businessDate: '2026-01-01',
        opensAt: new Date(),
        closesAt: new Date(),
        status: 'open',
        closedBy: null,
        closedAt: null,
      }),
    )
  })
})

describe('businessDays', () => {
  test('any signed-in same-branch user can create (lazy creation)', async () => {
    const db = stationCtx().firestore()
    await assertSucceeds(
      setDoc(doc(db, 'businessDays/001_2026-01-01'), {
        branchId: '001',
        businessDate: '2026-01-01',
        opensAt: new Date(),
        closesAt: new Date(),
        status: 'open',
        closedBy: null,
        closedAt: null,
      }),
    )
  })

  test('only a manager can close a business day', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'businessDays/001_2026-01-02'), {
        branchId: '001', businessDate: '2026-01-02', opensAt: new Date(), closesAt: new Date(),
        status: 'open', closedBy: null, closedAt: null,
      })
    })

    await assertFails(updateDoc(doc(staffCtx().firestore(), 'businessDays/001_2026-01-02'), { status: 'closed' }))
    await assertSucceeds(updateDoc(doc(managerCtx().firestore(), 'businessDays/001_2026-01-02'), { status: 'closed' }))
  })
})

// M1 — docs/04-M1-COLDCHAIN.md / docs/02-DATA-MODEL.md explicitly ask for:
// "station cannot release quarantine · nobody can update a temperature
// reading · nobody can delete an audit entry · a station account cannot
// read another branch" — the last two are already covered above.
describe('equipment', () => {
  test('a manager can create equipment; a station account cannot', async () => {
    const equipment = {
      branchId: '001', assetId: 'CH-01', type: 'chiller', make: '', model: '', serial: '', supplier: '',
      purchaseDate: null, warrantyExpiry: null, zone: 'Ramyeon station', status: 'active',
      requiresTemperatureLog: true, thresholds: { minC: 0, maxC: 4, maxExcursionMinutes: null },
      thresholdSource: 'Manual Appendix G', notes: '',
    }
    await assertSucceeds(setDoc(doc(managerCtx().firestore(), 'equipment/eq1'), equipment))
    await assertFails(setDoc(doc(stationCtx().firestore(), 'equipment/eq2'), { ...equipment, assetId: 'CH-02' }))
  })
})

describe('temperatureReadings — append only', () => {
  const reading = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', equipmentId: 'eq1', assetId: 'CH-01', valueC: 8,
    readAt: new Date(), method: 'manual', photoRef: null, withinRange: false, scheduledSlot: '21:00',
    duplicateFlag: false,
  }

  test('a station account can create a reading with a valid stamp', async () => {
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'temperatureReadings/r1'), { ...reading, createdAt: serverTimestamp() }),
    )
  })

  test('nobody can update or delete a reading, including a manager', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'temperatureReadings/r2'), { ...reading, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'temperatureReadings/r2'), { valueC: 4 }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'temperatureReadings/r2')))
  })
})

describe('excursions', () => {
  test('any signed-in same-branch user can progress an open excursion', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'excursions/e1'), {
        branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
        createdAt: new Date(), deviceId: 'd1', equipmentId: 'eq1', assetId: 'CH-01', startedAt: new Date(),
        endedAt: null, startReadingId: 'r1', peakC: 8, durationMinutes: null, autoDetected: true,
        firstChecks: null, status: 'open', exceptionId: null, ticketId: null, closedBy: null, closedAt: null,
        closureNote: '',
      })
    })
    await assertSucceeds(updateDoc(doc(stationCtx().firestore(), 'excursions/e1'), { status: 'recovered' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'excursions/e1')))
  })
})

describe('quarantineLots', () => {
  const lot = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', excursionId: 'e1', itemName: 'Gimbap filling', lot: null, qty: 5,
    unit: 'kg', estValueCentavos: 150000, location: 'CH-01', status: 'quarantined', disposition: null,
  }

  test('a station account (crew) can quarantine a lot', async () => {
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'quarantineLots/q1'), { ...lot, createdAt: serverTimestamp() }))
  })

  test('a station account cannot release quarantine — a store_manager can, with a basis', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'quarantineLots/q2'), { ...lot, createdAt: new Date() })
    })

    await assertFails(
      updateDoc(doc(stationCtx().firestore(), 'quarantineLots/q2'), {
        status: 'released',
        disposition: { outcome: 'released', basis: 'trying anyway', decidedBy: 'x', decidedAt: new Date(), evidenceRefs: [], wastageRecordId: null },
      }),
    )
    await assertFails(
      updateDoc(doc(managerCtx().firestore(), 'quarantineLots/q2'), {
        status: 'released',
        disposition: { outcome: 'released', basis: '', decidedBy: 'x', decidedAt: new Date(), evidenceRefs: [], wastageRecordId: null },
      }),
    )
    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'quarantineLots/q2'), {
        status: 'released',
        disposition: { outcome: 'released', basis: 'Verified back in range by technician', decidedBy: 'mgr', decidedAt: new Date(), evidenceRefs: [], wastageRecordId: null },
      }),
    )
  })

  test('ops_head cannot release quarantine — only store_manager and owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'quarantineLots/q3'), { ...lot, createdAt: new Date() })
    })
    const opsHeadCtx = testEnv.authenticatedContext('ops-head-uid', { role: 'ops_head', branchId: '001' })
    await assertFails(
      updateDoc(doc(opsHeadCtx.firestore(), 'quarantineLots/q3'), {
        status: 'released',
        disposition: { outcome: 'released', basis: 'ops head trying', decidedBy: 'x', decidedAt: new Date(), evidenceRefs: [], wastageRecordId: null },
      }),
    )
  })
})

describe('maintenanceTickets', () => {
  const ticket = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', equipmentId: 'eq1', assetId: 'CH-01', symptom: 'Running warm',
    tradeImpact: 'reduced', stockAtRisk: false, reportedAt: new Date(), technician: null, calledAt: null,
    attendedAt: null, diagnosis: '', workDone: '', partsReplaced: '', underWarranty: null, costCentavos: null,
    invoiceRef: '', downtimeMinutes: null, preventiveAdvice: '', status: 'open', verifiedWorkingBy: null,
    closedAt: null,
  }

  test('cannot close a ticket without verifiedWorkingBy; can with it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'maintenanceTickets/t1'), { ...ticket, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'maintenanceTickets/t1'), { status: 'closed' }))
    await assertFails(
      updateDoc(doc(managerCtx().firestore(), 'maintenanceTickets/t1'), { status: 'closed', verifiedWorkingBy: '' }),
    )
    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'maintenanceTickets/t1'), {
        status: 'closed',
        verifiedWorkingBy: 'Store Manager',
      }),
    )
  })
})

// M2 — docs/07-M2-CHECKLISTS.md
describe('checklistTemplates', () => {
  test('a manager can create a template; a station account cannot', async () => {
    const template = {
      branchId: '001', name: 'Opening', category: 'opening', version: 1, active: true,
      items: [{ id: 'i1', label: 'Lights on', type: 'pass_fail', required: true, numericMin: null, numericMax: null }],
      createdBy: 'mgr', createdAt: new Date(),
    }
    await assertSucceeds(setDoc(doc(managerCtx().firestore(), 'checklistTemplates/tpl1'), template))
    await assertFails(setDoc(doc(stationCtx().firestore(), 'checklistTemplates/tpl2'), { ...template, name: 'x' }))
  })
})

describe('checklistResponses — append only', () => {
  test('a station account can create a response; nobody can update or delete it', async () => {
    const response = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: serverTimestamp(), deviceId: 'd1', runId: 'run1', itemId: 'i1', itemLabel: 'Lights on',
      type: 'pass_fail', valueBool: true, valueNumber: null, valueText: null, photoRef: null,
      withinRange: null, passed: true,
    }
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'checklistResponses/r1'), response))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'checklistResponses/r2'), { ...response, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'checklistResponses/r2'), { passed: false }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'checklistResponses/r2')))
  })
})

describe('wastageRecords', () => {
  test('crew and manager can record wastage; nobody can edit or delete it', async () => {
    const record = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: serverTimestamp(), deviceId: 'd1', source: 'manual', sourceId: null,
      itemName: 'Gimbap', qty: 2, unit: 'pcs', estValueCentavos: 8000, reason: 'dropped',
    }
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'wastageRecords/w1'), record))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'wastageRecords/w2'), { ...record, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'wastageRecords/w2'), { qty: 3 }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'wastageRecords/w2')))
  })
})

// M3 — docs/08-M3-TIME-ROSTER-CERTIFICATION.md
describe('timeEntries — append only', () => {
  test('a station account can clock in; nobody can update or delete the entry', async () => {
    const entry = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: serverTimestamp(), deviceId: 'd1', userId: 'staff-1', userName: 'Staff',
      type: 'clock_in', at: serverTimestamp(), photoRef: 'branches/001/time-entries/t1.jpg', method: 'station',
    }
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'timeEntries/t1'), entry))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'timeEntries/t2'), { ...entry, createdAt: new Date(), at: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'timeEntries/t2'), { type: 'clock_out' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'timeEntries/t2')))
  })
})

describe('rosterAssignments', () => {
  test('a manager can create and update an assignment; a station account cannot create one', async () => {
    const assignment = {
      branchId: '001', businessDayId: '001_2026-01-01', shiftInstanceId: 'shift-1', actorId: 'mgr-1', actorName: 'Manager',
      createdAt: serverTimestamp(), deviceId: 'd1', userId: 'staff-1', userName: 'Staff', role: 'cashier', status: 'planned',
    }
    await assertSucceeds(setDoc(doc(managerCtx().firestore(), 'rosterAssignments/ra1'), assignment))
    await assertFails(setDoc(doc(stationCtx().firestore(), 'rosterAssignments/ra2'), { ...assignment, userId: 'staff-2' }))

    await assertSucceeds(updateDoc(doc(managerCtx().firestore(), 'rosterAssignments/ra1'), { status: 'cancelled' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'rosterAssignments/ra1')))
  })
})

// M4 — docs/09-M4-CASH-CONTROL.md
const shiftLeaderCtx = () => testEnv.authenticatedContext('leader-uid', { role: 'shift_leader', branchId: '001' })

describe('cashSessions', () => {
  test('any signed-in same-branch user can open and close a session', async () => {
    const session = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: undefined, deviceId: 'd1', userId: 'staff-1', userName: 'Staff', openedAt: undefined,
      openingFloatCentavos: 200000, status: 'open', closedAt: null,
    }
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'cashSessions/cs1'), {
        ...session,
        createdAt: serverTimestamp(),
        openedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(updateDoc(doc(stationCtx().firestore(), 'cashSessions/cs1'), { status: 'closed' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'cashSessions/cs1')))
  })
})

describe('cashDrops', () => {
  const drop = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', sessionId: 'cs1', amountCentavos: 50000, bagNumber: 'BAG-01',
    status: 'dropped', receivedBy: null, receivedAt: null,
  }

  test('crew can log a drop; only a manager can confirm receipt', async () => {
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'cashDrops/d1'), { ...drop, createdAt: serverTimestamp() }))

    await assertFails(
      updateDoc(doc(stationCtx().firestore(), 'cashDrops/d1'), {
        status: 'received', receivedBy: 'crew trying anyway', receivedAt: new Date(),
      }),
    )
    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'cashDrops/d1'), {
        status: 'received', receivedBy: 'Store Manager', receivedAt: new Date(),
      }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'cashDrops/d1')))
  })
})

describe('cashCloseCounts — blind count and reveal', () => {
  const count = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', sessionId: 'cs1', countedCentavos: 195000, countedAt: undefined,
    countedBy: 'Staff', expectedCentavos: null, revealedBy: null, revealedAt: null, varianceCentavos: null,
    requiresInvestigation: false, investigationNote: '', status: 'counted',
  }

  test('any signed-in same-branch user can submit a blind count with no expected figure', async () => {
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'cashCloseCounts/cc1'), {
        ...count,
        createdAt: serverTimestamp(),
        countedAt: serverTimestamp(),
      }),
    )
  })

  test('a cashier cannot reveal the expected figure; a shift leader can', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'cashCloseCounts/cc2'), { ...count, createdAt: new Date(), countedAt: new Date() })
    })
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), 'cashCloseCounts/cc2'), {
        expectedCentavos: 200000, varianceCentavos: -5000, status: 'revealed',
      }),
    )
    await assertSucceeds(
      updateDoc(doc(shiftLeaderCtx().firestore(), 'cashCloseCounts/cc2'), {
        expectedCentavos: 200000, varianceCentavos: -5000, requiresInvestigation: false, status: 'revealed',
      }),
    )
  })
})

describe('cashRegisterExceptions', () => {
  test('crew can log an entry; a cashier cannot approve it, a shift leader can', async () => {
    const entry = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: undefined, deviceId: 'd1', sessionId: 'cs1', type: 'void', amountCentavos: 60000,
      reason: 'Rang wrong item', approvalRequired: true, approvedBy: null, approvedAt: null,
    }
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'cashRegisterExceptions/x1'), { ...entry, createdAt: serverTimestamp() }))

    await assertFails(
      updateDoc(doc(staffCtx().firestore(), 'cashRegisterExceptions/x1'), { approvedBy: 'cashier trying anyway', approvedAt: new Date() }),
    )
    await assertSucceeds(
      updateDoc(doc(shiftLeaderCtx().firestore(), 'cashRegisterExceptions/x1'), { approvedBy: 'Shift Leader', approvedAt: new Date() }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'cashRegisterExceptions/x1')))
  })
})

// M5 — docs/10-M5-INCIDENTS.md
describe('incidentRecords', () => {
  const incident = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1', type: 'theft', severity: 'high', occurredAt: undefined,
    narrative: 'Cash drawer found short after a distraction at the counter.', immediateAction: 'Notified shift leader, drawer secured.',
    status: 'open', exceptionId: null, rootCause: '', closedBy: null, closedAt: null,
  }

  test('any signed-in same-branch user can report an incident', async () => {
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'incidentRecords/i1'), {
        ...incident,
        createdAt: serverTimestamp(),
        occurredAt: serverTimestamp(),
      }),
    )
  })

  test('cannot close without a root cause; can with one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'incidentRecords/i2'), { ...incident, createdAt: new Date(), occurredAt: new Date() })
    })
    await assertFails(updateDoc(doc(stationCtx().firestore(), 'incidentRecords/i2'), { status: 'closed', rootCause: '' }))
    await assertSucceeds(
      updateDoc(doc(stationCtx().firestore(), 'incidentRecords/i2'), {
        status: 'closed',
        rootCause: 'Distraction theft — till procedure reviewed with staff.',
        closedBy: 'Shift Leader', closedAt: new Date(),
      }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'incidentRecords/i2')))
  })
})

describe('cctvPreservations — append only', () => {
  test('a signed-in user can preserve a clip; nobody can edit or delete it', async () => {
    const preservation = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: undefined, deviceId: 'd1', incidentId: 'i1', cameras: ['front-door'],
      rangeStart: undefined, rangeEnd: undefined, clipRef: 'dvr-export-2026-08-22-001.mp4', retainUntil: undefined,
    }
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'cctvPreservations/p1'), {
        ...preservation,
        createdAt: serverTimestamp(),
        rangeStart: serverTimestamp(),
        rangeEnd: serverTimestamp(),
        retainUntil: serverTimestamp(),
      }),
    )

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'cctvPreservations/p2'), {
        ...preservation, createdAt: new Date(), rangeStart: new Date(), rangeEnd: new Date(), retainUntil: new Date(),
      })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'cctvPreservations/p2'), { clipRef: 'x' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'cctvPreservations/p2')))
  })
})

// M6 — docs/11-M6-SHIFT-HANDOVER.md
describe('shiftHandovers', () => {
  const handover = {
    branchId: '001', businessDayId: null, shiftInstanceId: 'shift-1', actorId: 'staff-1', actorName: 'Staff',
    createdAt: undefined, deviceId: 'd1',
    pack: {
      generatedAt: undefined, openExceptions: [], openIncidentCount: 0, openTicketCount: 0,
      cashSessionsStillOpen: 0, checklistsCompletedToday: 3, checklistsMissedToday: 0,
    },
    status: 'pending', acceptedBy: null, acceptedByName: null, acceptedAt: null, incomingNote: '',
  }

  test('any signed-in same-branch user can generate and accept a handover', async () => {
    await assertSucceeds(
      setDoc(doc(stationCtx().firestore(), 'shiftHandovers/h1'), {
        ...handover,
        createdAt: serverTimestamp(),
        pack: { ...handover.pack, generatedAt: serverTimestamp() },
      }),
    )
    await assertSucceeds(
      updateDoc(doc(stationCtx().firestore(), 'shiftHandovers/h1'), {
        status: 'accepted', acceptedBy: 'staff-2', acceptedByName: 'Shift Leader 2', acceptedAt: new Date(), incomingNote: 'All clear.',
      }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'shiftHandovers/h1')))
  })

  test("a station account cannot create a handover for another branch", async () => {
    await assertFails(
      setDoc(doc(stationCtx().firestore(), 'shiftHandovers/h2'), {
        ...handover,
        branchId: '002',
        createdAt: serverTimestamp(),
        pack: { ...handover.pack, generatedAt: serverTimestamp() },
      }),
    )
  })
})

// M7 — docs/12-M7-DOCUMENT-CONTROL.md
describe('documents', () => {
  const documentV1 = {
    branchId: '001', branchApplicability: null, code: 'SOP-COLDCHAIN-01', title: 'Cold chain SOP',
    category: 'sop', version: 1, active: true, fileRef: 'branches/001/documents/d1.pdf', fileSizeBytes: 12345,
    supersedesId: null, createdBy: 'Store Manager', createdAt: undefined,
  }

  test('a manager can create a document version; a station account cannot', async () => {
    await assertSucceeds(setDoc(doc(managerCtx().firestore(), 'documents/d1'), { ...documentV1, createdAt: serverTimestamp() }))
    await assertFails(
      setDoc(doc(stationCtx().firestore(), 'documents/d2'), { ...documentV1, code: 'SOP-COLDCHAIN-02', createdAt: serverTimestamp() }),
    )
  })

  test('a manager can supersede a version; a station account cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documents/d3'), { ...documentV1, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(stationCtx().firestore(), 'documents/d3'), { active: false }))
    await assertSucceeds(updateDoc(doc(managerCtx().firestore(), 'documents/d3'), { active: false }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'documents/d3')))
  })
})

describe('documentAcknowledgments — append only', () => {
  test('any signed-in same-branch user can acknowledge; nobody can edit or delete it', async () => {
    const ack = {
      branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'staff-1', actorName: 'Staff',
      createdAt: undefined, deviceId: 'd1', documentId: 'd1', documentCode: 'SOP-COLDCHAIN-01',
    }
    await assertSucceeds(setDoc(doc(stationCtx().firestore(), 'documentAcknowledgments/a1'), { ...ack, createdAt: serverTimestamp() }))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'documentAcknowledgments/a2'), { ...ack, createdAt: new Date() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'documentAcknowledgments/a2'), { documentCode: 'x' }))
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'documentAcknowledgments/a2')))
  })
})

// M8 — docs/13-M8-DASHBOARD-DIGEST.md
describe('dailySummaries — Cloud-Function-only', () => {
  test('no client, including a manager, can write dailySummaries; same-branch read is allowed', async () => {
    const summary = {
      branchId: '001', businessDate: '2026-08-22', computedAt: serverTimestamp(),
      temperature: { readingsDue: 10, readingsTaken: 9, missed: 1, excursionsOpened: 0, excursionsOpen: 0 },
      quarantine: { lotsOpen: 0, estValueCentavos: 0 },
      maintenance: { ticketsOpen: 0, ticketsOpened: 0, ticketsClosed: 0 },
      exceptions: { opened: 2, closed: 1, openTotal: 1, overdue: 0 },
      staffing: { shiftsPlanned: 2, shiftsShort: 0 },
      cash: { sessionsOpenAtClose: 0, totalVarianceCentavos: 0, unresolvedInvestigations: 0 },
      certifications: { expiringCount: null },
    }
    await assertFails(setDoc(doc(managerCtx().firestore(), 'dailySummaries/001_2026-08-22'), summary))
    await assertFails(setDoc(doc(ownerCtx().firestore(), 'dailySummaries/001_2026-08-22'), summary))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'dailySummaries/001_2026-08-22'), summary)
    })
    await assertSucceeds(getDoc(doc(managerCtx().firestore(), 'dailySummaries/001_2026-08-22')))
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'dailySummaries/001_2026-08-22'), { 'staffing.shiftsShort': 5 }))
  })
})

describe('mail — closed to every client', () => {
  test('nobody, including the owner, can read or write mail', async () => {
    const mail = { to: 'owner@g7.internal', message: { subject: 'test', text: 'test' } }
    await assertFails(setDoc(doc(ownerCtx().firestore(), 'mail/m1'), mail))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'mail/m2'), mail)
    })
    await assertFails(getDoc(doc(ownerCtx().firestore(), 'mail/m2')))
  })
})

// M9 — docs/14-M9-EMPLOYEE-SELF-SERVICE.md
describe('leaveRequests', () => {
  const request = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'emp-uid', actorName: 'emp@g7.internal',
    createdAt: undefined, deviceId: 'd1', userId: 'staff-1', userName: 'Staff', type: 'company',
    startDate: '2026-09-01', endDate: '2026-09-03', reason: 'Family event',
    coverageSnapshot: [], status: 'pending', decidedBy: null, decidedByName: null, decidedAt: null, decisionNote: '',
  }

  test('a signed-in user can request leave; only a manager can decide it', async () => {
    await assertSucceeds(setDoc(doc(staffCtx().firestore(), 'leaveRequests/lr1'), { ...request, createdAt: serverTimestamp() }))

    await assertFails(updateDoc(doc(staffCtx().firestore(), 'leaveRequests/lr1'), { status: 'approved' }))
    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'leaveRequests/lr1'), {
        status: 'approved', decidedBy: 'mgr', decidedByName: 'Manager', decidedAt: new Date(), decisionNote: '',
      }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'leaveRequests/lr1')))
  })
})

describe('timeEntryDisputes', () => {
  const dispute = {
    branchId: '001', businessDayId: null, shiftInstanceId: null, actorId: 'emp-uid', actorName: 'emp@g7.internal',
    createdAt: undefined, deviceId: 'd1', userId: 'staff-1', userName: 'Staff', timeEntryId: 't1',
    reason: 'Clock-in time looks wrong', status: 'open', resolvedBy: null, resolvedByName: null, resolvedAt: null,
    correctionEntryId: null,
  }

  test('a signed-in user can flag a dispute; only a manager can resolve it', async () => {
    await assertSucceeds(setDoc(doc(staffCtx().firestore(), 'timeEntryDisputes/td1'), { ...dispute, createdAt: serverTimestamp() }))

    await assertFails(updateDoc(doc(staffCtx().firestore(), 'timeEntryDisputes/td1'), { status: 'resolved' }))
    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'timeEntryDisputes/td1'), {
        status: 'resolved', resolvedBy: 'mgr', resolvedByName: 'Manager', resolvedAt: new Date(), correctionEntryId: 't2',
      }),
    )
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'timeEntryDisputes/td1')))
  })
})

describe('items (M10 item master bridge)', () => {
  const item = {
    sourceItemId: 'gpos-item-1', sku: 'RAMYEON-1', barcode: '1000000000001', name: 'Shin Ramyeon',
    category: 'noodle', priceCentavos: 15000, vatClass: 'vatable', presentInLatestExport: true,
    reorderPoint: null, defaultSupplierId: null, unitOfPurchase: null, active: true,
    lastSyncedAt: null, createdAt: undefined,
  }

  test('no client can create or delete an item — only runCatalogueSync (Admin SDK) writes one', async () => {
    await assertFails(setDoc(doc(managerCtx().firestore(), 'items/i1'), { ...item, createdAt: serverTimestamp() }))

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'items/i1'), { ...item, createdAt: serverTimestamp() })
    })
    await assertFails(deleteDoc(doc(managerCtx().firestore(), 'items/i1')))
  })

  test('a manager can update the three operational fields; a cashier cannot update any of them', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'items/i1'), { ...item, createdAt: serverTimestamp() })
    })

    await assertSucceeds(
      updateDoc(doc(managerCtx().firestore(), 'items/i1'), { reorderPoint: 10, unitOfPurchase: 'case of 24' }),
    )
    await assertFails(updateDoc(doc(staffCtx().firestore(), 'items/i1'), { reorderPoint: 5 }))
  })

  test('a manager cannot change a synced field, even alongside an operational one', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'items/i1'), { ...item, createdAt: serverTimestamp() })
    })
    await assertFails(updateDoc(doc(managerCtx().firestore(), 'items/i1'), { reorderPoint: 10, priceCentavos: 99999 }))
  })

  test('any signed-in user can read items', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'items/i1'), { ...item, createdAt: serverTimestamp() })
    })
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), 'items/i1')))
  })
})

describe('catalogueSyncs (M10)', () => {
  const sync = {
    trigger: 'manual', triggeredBy: 'manager-uid', triggeredByName: 'Manager', handoverId: null,
    sourceExportedAt: '2026-09-05T00:00:00.000Z', status: 'ok', errorMessage: null,
    newCount: 1, changedCount: 0, missingCount: 0, createdAt: undefined,
  }

  test('no client, including a manager, can write a sync record — Admin SDK only', async () => {
    await assertFails(setDoc(doc(managerCtx().firestore(), 'catalogueSyncs/s1'), { ...sync, createdAt: serverTimestamp() }))
  })

  test('a manager can read sync history; a cashier cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'catalogueSyncs/s1'), { ...sync, createdAt: serverTimestamp() })
    })
    await assertSucceeds(getDoc(doc(managerCtx().firestore(), 'catalogueSyncs/s1')))
    await assertFails(getDoc(doc(staffCtx().firestore(), 'catalogueSyncs/s1')))
  })
})
