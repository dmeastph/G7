// M0 Cloud Functions — see docs/03-M0-FOUNDATION.md §4-5. closeBusinessDay
// (M8) added below — see docs/13-M8-DASHBOARD-DIGEST.md.
// setUserRole: only path that mints the `role`/`branchId` custom claims
// security rules actually check. resetUserPin: only path that hashes a
// staff PIN — bcrypt happens here, server-side, never in the browser bundle
// for a PIN being *set* (client-side bcrypt is only used to *verify*).
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { defineSecret, defineString } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import bcrypt from 'bcryptjs'
import { computeCatalogueDiff, type FetchedItem, type ExistingItem } from './catalogueSync.js'

initializeApp()

const ROLE_CODES = [
  'owner',
  'ops_head',
  'store_manager',
  'shift_leader',
  'cashier',
  'kitchen_staff',
  'store_staff',
  'auditor',
  'trainer',
  'technician',
  'station',
] as const
type RoleCode = (typeof ROLE_CODES)[number]

const MANAGER_ROLES = new Set(['owner', 'ops_head', 'store_manager'])

function requireCallerRole(auth: { token?: Record<string, unknown> } | undefined, allowed: Set<string>) {
  const role = auth?.token?.role as string | undefined
  if (!role || !allowed.has(role)) {
    throw new HttpsError('permission-denied', 'Not authorised for this action.')
  }
}

type SetUserRoleRequest = {
  targetAuthUid: string
  role: RoleCode
  branchId: string | null
  userId?: string
}

/** Sets the custom claims security rules check. A user's Firestore profile
 *  may list several `roles` (docs/02-DATA-MODEL.md); this is the single
 *  claim that governs what their session is authorised to do.
 *
 *  `userId` (M9, docs/14-M9-EMPLOYEE-SELF-SERVICE.md "Granting personal
 *  access") links a personal login to the employee's existing `users` doc
 *  by writing `authUid` in the same call — granting the claim and linking
 *  the identity together is one conceptual action, not two functions that
 *  must both be called correctly in sequence. */
export const setUserRole = onCall<SetUserRoleRequest>(async (request) => {
  requireCallerRole(request.auth, new Set(['owner']))

  const { targetAuthUid, role, branchId, userId } = request.data
  if (!targetAuthUid || !ROLE_CODES.includes(role)) {
    throw new HttpsError('invalid-argument', 'targetAuthUid and a valid role are required.')
  }

  await getAuth().setCustomUserClaims(targetAuthUid, { role, branchId: branchId ?? null })

  if (userId) {
    await getFirestore().collection('users').doc(userId).update({ authUid: targetAuthUid })
  }

  await getFirestore().collection('auditLog').add({
    entity: 'authClaims',
    entityId: targetAuthUid,
    action: 'role_change',
    before: null,
    after: { role, branchId: branchId ?? null, linkedUserId: userId ?? null },
    actorId: request.auth!.uid,
    actorName: (request.auth!.token.email as string | undefined) ?? request.auth!.uid,
    at: FieldValue.serverTimestamp(),
    deviceId: 'cloud-function:setUserRole',
    branchId: branchId ?? 'n/a',
  })

  return { ok: true }
})

type CloseBusinessDayRequest = {
  branchId: string
  businessDayId: string
}

/** Computes dailySummaries and closes the business day — real aggregation
 *  over a full day's raw records, the case docs/01-ARCHITECTURE.md reserves
 *  for a server-side rollup rather than a client doing it with
 *  rules-restricted reads. Manager-only, same guard as setUserRole/
 *  resetUserPin. See docs/13-M8-DASHBOARD-DIGEST.md. */
export const closeBusinessDay = onCall<CloseBusinessDayRequest>(async (request) => {
  requireCallerRole(request.auth, MANAGER_ROLES)

  const { branchId, businessDayId } = request.data
  if (!branchId || !businessDayId) {
    throw new HttpsError('invalid-argument', 'branchId and businessDayId are required.')
  }

  const db = getFirestore()
  const businessDayRef = db.collection('businessDays').doc(businessDayId)
  const businessDaySnap = await businessDayRef.get()
  if (!businessDaySnap.exists) throw new HttpsError('not-found', 'Business day not found.')
  const businessDay = businessDaySnap.data() as {
    branchId: string
    businessDate: string
    opensAt: Timestamp
    closesAt: Timestamp
    status: string
  }
  if (businessDay.branchId !== branchId) {
    throw new HttpsError('invalid-argument', 'branchId does not match this business day.')
  }

  const [
    readingsSnap,
    excursionsOpenSnap,
    missedTemperatureSnap,
    quarantineOpenSnap,
    ticketsSnap,
    exceptionsAllSnap,
    exceptionsOpenedTodaySnap,
    shiftInstancesSnap,
    shiftTemplatesSnap,
    rosterTodaySnap,
    cashSessionsOpenSnap,
    cashCountsTodaySnap,
    usersSnap,
    certWarningParamSnap,
  ] = await Promise.all([
    db.collection('temperatureReadings').where('branchId', '==', branchId).where('businessDayId', '==', businessDayId).get(),
    db.collection('excursions').where('branchId', '==', branchId).where('status', '==', 'open').get(),
    db
      .collection('exceptions')
      .where('branchId', '==', branchId)
      .where('businessDayId', '==', businessDayId)
      .where('source', '==', 'temperature')
      .get(),
    db.collection('quarantineLots').where('branchId', '==', branchId).where('status', '==', 'quarantined').get(),
    db.collection('maintenanceTickets').where('branchId', '==', branchId).get(),
    db.collection('exceptions').where('branchId', '==', branchId).get(),
    db.collection('exceptions').where('branchId', '==', branchId).where('businessDayId', '==', businessDayId).get(),
    db.collection('shiftInstances').where('branchId', '==', branchId).where('businessDayId', '==', businessDayId).get(),
    db.collection('shiftTemplates').where('branchId', '==', branchId).get(),
    db.collection('rosterAssignments').where('branchId', '==', branchId).where('businessDayId', '==', businessDayId).get(),
    db.collection('cashSessions').where('branchId', '==', branchId).where('status', '==', 'open').get(),
    db.collection('cashCloseCounts').where('branchId', '==', branchId).where('businessDayId', '==', businessDayId).get(),
    db.collection('users').where('branchIds', 'array-contains', branchId).where('status', '==', 'active').get(),
    db.collection('parameters').where('key', '==', 'staff.certification_expiry_warning_days').where('effectiveTo', '==', null).get(),
  ])

  // Temperature — "due" is derived from what's provable (a reading or a
  // missed-exception exists), not a re-derivation of the slot schedule a
  // second time in a second codebase. Same honest-limitation reasoning M1's
  // own client-side missed-reading detection already documents.
  const readingsTaken = readingsSnap.size
  const missed = missedTemperatureSnap.size
  const temperature = {
    readingsDue: readingsTaken + missed,
    readingsTaken,
    missed,
    excursionsOpened: readingsSnap.docs.filter((d) => d.data().withinRange === false).length,
    excursionsOpen: excursionsOpenSnap.size,
  }

  const quarantine = {
    lotsOpen: quarantineOpenSnap.size,
    estValueCentavos: quarantineOpenSnap.docs.reduce((sum, d) => sum + (d.data().estValueCentavos ?? 0), 0),
  }

  const opensAtMs = businessDay.opensAt.toMillis()
  const closesAtMs = businessDay.closesAt.toMillis()
  const ticketDocs = ticketsSnap.docs.map((d) => d.data())
  const maintenance = {
    ticketsOpen: ticketDocs.filter((t) => t.status === 'open' || t.status === 'attended').length,
    ticketsOpened: ticketDocs.filter((t) => t.businessDayId === businessDayId).length,
    ticketsClosed: ticketDocs.filter((t) => {
      if (t.status !== 'closed' || !t.closedAt) return false
      const ms = (t.closedAt as Timestamp).toMillis()
      return ms >= opensAtMs && ms < closesAtMs
    }).length,
  }

  const exceptionsAll = exceptionsAllSnap.docs.map((d) => d.data())
  const now = Timestamp.now()
  const exceptions = {
    opened: exceptionsOpenedTodaySnap.size,
    closed: exceptionsOpenedTodaySnap.docs.filter((d) => d.data().status === 'resolved').length,
    openTotal: exceptionsAll.filter((e) => e.status === 'open' || e.status === 'in_progress' || e.status === 'escalated').length,
    overdue: exceptionsAll.filter(
      (e) => (e.status === 'open' || e.status === 'in_progress') && e.dueAt && (e.dueAt as Timestamp).toMillis() < now.toMillis(),
    ).length,
  }

  const templateById = new Map(shiftTemplatesSnap.docs.map((d) => [d.id, d.data()]))
  const rosterCountByShift = new Map<string, number>()
  rosterTodaySnap.docs.forEach((d) => {
    const data = d.data()
    if (data.status === 'cancelled') return
    rosterCountByShift.set(data.shiftInstanceId, (rosterCountByShift.get(data.shiftInstanceId) ?? 0) + 1)
  })
  const staffing = {
    shiftsPlanned: shiftInstancesSnap.size,
    shiftsShort: shiftInstancesSnap.docs.filter((d) => {
      const template = templateById.get(d.data().templateId)
      const min = template?.targetHeadcount?.min ?? 0
      return (rosterCountByShift.get(d.id) ?? 0) < min
    }).length,
  }

  const cash = {
    sessionsOpenAtClose: cashSessionsOpenSnap.size,
    totalVarianceCentavos: cashCountsTodaySnap.docs.reduce((sum, d) => sum + (d.data().varianceCentavos ?? 0), 0),
    unresolvedInvestigations: cashCountsTodaySnap.docs.filter(
      (d) => d.data().status === 'revealed' && d.data().requiresInvestigation && !d.data().investigationNote,
    ).length,
  }

  const certWarningDays = certWarningParamSnap.empty ? null : (certWarningParamSnap.docs[0].data().value as number | null)
  let expiringCount: number | null = null
  if (certWarningDays !== null && certWarningDays !== undefined) {
    const cutoffMs = now.toMillis() + certWarningDays * 24 * 60 * 60 * 1000
    expiringCount = usersSnap.docs.filter((d) => {
      const certs = d.data().certifications ?? {}
      return Object.values(certs).some((c) => {
        const cert = c as { expiresAt: Timestamp | null }
        if (!cert.expiresAt) return false
        const ms = cert.expiresAt.toMillis()
        return ms > now.toMillis() && ms <= cutoffMs
      })
    }).length
  }
  const certifications = { expiringCount }

  const dailySummaryId = `${branchId}_${businessDay.businessDate}`
  const summary = {
    branchId,
    businessDate: businessDay.businessDate,
    computedAt: FieldValue.serverTimestamp(),
    temperature,
    quarantine,
    maintenance,
    exceptions,
    staffing,
    cash,
    certifications,
  }

  const batch = db.batch()
  batch.set(db.collection('dailySummaries').doc(dailySummaryId), summary)
  batch.update(businessDayRef, { status: 'closed', closedBy: request.auth!.uid, closedAt: FieldValue.serverTimestamp() })
  await batch.commit()

  // Best-effort — a missing/unconfigured mail extension must never fail
  // the close itself (docs/13-M8-DASHBOARD-DIGEST.md "Why the digest's
  // delivery is a seam, not a vendor").
  try {
    const { users: authUsers } = await getAuth().listUsers()
    const owner = authUsers.find((u) => u.customClaims?.role === 'owner' && u.email)
    if (owner?.email) {
      const lines = [
        `G7 daily digest — ${businessDay.businessDate}`,
        '',
        `Temperature: ${temperature.readingsTaken}/${temperature.readingsDue} readings taken, ${temperature.missed} missed, ${temperature.excursionsOpen} excursion(s) still open.`,
        `Quarantine: ${quarantine.lotsOpen} lot(s) open, ${(quarantine.estValueCentavos / 100).toFixed(2)} PHP at risk.`,
        `Maintenance: ${maintenance.ticketsOpen} ticket(s) open.`,
        `Exceptions: ${exceptions.openTotal} open (${exceptions.overdue} overdue), ${exceptions.opened} opened today.`,
        `Staffing: ${staffing.shiftsShort}/${staffing.shiftsPlanned} shift(s) short.`,
        `Cash: ${cash.sessionsOpenAtClose} session(s) still open, ${cash.unresolvedInvestigations} unresolved investigation(s).`,
        certifications.expiringCount === null
          ? 'Certifications: expiry warning window not set.'
          : `Certifications: ${certifications.expiringCount} expiring soon.`,
      ]
      await db.collection('mail').add({
        to: owner.email,
        message: { subject: `G7 daily digest — ${businessDay.businessDate}`, text: lines.join('\n') },
      })
    }
  } catch (err) {
    logger.warn('closeBusinessDay: mail queue failed, close still succeeded', err)
  }

  await db.collection('auditLog').add({
    entity: 'dailySummaries',
    entityId: dailySummaryId,
    action: 'close',
    before: null,
    after: { businessDate: businessDay.businessDate },
    actorId: request.auth!.uid,
    actorName: (request.auth!.token.email as string | undefined) ?? request.auth!.uid,
    at: FieldValue.serverTimestamp(),
    deviceId: 'cloud-function:closeBusinessDay',
    branchId,
  })

  return { ok: true, dailySummaryId }
})

type ResetUserPinRequest = {
  userId: string
  newPin: string
  branchId: string
}

/** PINs are set and reset only by a manager, hashed server-side
 *  (docs/03-M0-FOUNDATION.md §5) — the client never sees or sends a hash. */
export const resetUserPin = onCall<ResetUserPinRequest>(async (request) => {
  requireCallerRole(request.auth, MANAGER_ROLES)

  const { userId, newPin, branchId } = request.data
  if (!userId || !/^\d{4,6}$/.test(newPin ?? '')) {
    throw new HttpsError('invalid-argument', 'userId and a 4-6 digit newPin are required.')
  }

  const pinHash = bcrypt.hashSync(newPin, 10)
  await getFirestore().collection('users').doc(userId).update({ pinHash })

  await getFirestore().collection('auditLog').add({
    entity: 'user',
    entityId: userId,
    action: 'pin_reset',
    before: null,
    after: null, // never write a PIN or its hash into the audit trail
    actorId: request.auth!.uid,
    actorName: (request.auth!.token.email as string | undefined) ?? request.auth!.uid,
    at: FieldValue.serverTimestamp(),
    deviceId: 'cloud-function:resetUserPin',
    branchId,
  })

  return { ok: true }
})

// Item master bridge (docs/15-M10-ITEM-MASTER.md). g7-pos and g7-ops are
// deliberately separate Firebase projects (g7-pos/docs/13-DEPLOYMENT.md);
// this calls g7-pos's export endpoint server-to-server using a shared
// secret, never from the browser. Both secrets are set independently per
// project via `firebase functions:secrets:set CATALOGUE_SYNC_SECRET` — the
// same value on both sides, never committed, never sent to a client.
const catalogueSyncSecret = defineSecret('CATALOGUE_SYNC_SECRET')
// The deployed g7-pos export function's URL — not sensitive, so a plain
// string parameter (.env / functions config), not Secret Manager. Not
// hardcoded because it differs between the emulator and the real project,
// and because a 2nd-gen HTTPS function's exact URL is only known once
// deployed.
const g7PosExportUrl = defineString('G7_POS_EXPORT_URL')

type CatalogueSyncTrigger = 'handover' | 'manual'

/** The one function both the handover trigger and the manual button call.
 *  Never partially applies — a fetch failure writes a failed
 *  CatalogueSyncDoc and stops before touching `items` at all. A missing
 *  item is flagged, never deleted, which is what makes it safe to run
 *  this unattended three times a day with no human review gate. */
async function runCatalogueSync(
  trigger: CatalogueSyncTrigger,
  triggeredBy: string | null,
  triggeredByName: string | null,
  handoverId: string | null,
): Promise<void> {
  const db = getFirestore()
  const baseSyncDoc = { trigger, triggeredBy, triggeredByName, handoverId, createdAt: FieldValue.serverTimestamp() }

  let payload: { exportedAt: string; items: FetchedItem[] }
  try {
    const response = await fetch(g7PosExportUrl.value(), { headers: { 'x-sync-secret': catalogueSyncSecret.value() } })
    if (!response.ok) {
      throw new Error(`g7-pos export endpoint returned HTTP ${response.status}`)
    }
    payload = (await response.json()) as { exportedAt: string; items: FetchedItem[] }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(`runCatalogueSync (${trigger}): fetch failed — ${errorMessage}`)
    await db.collection('catalogueSyncs').add({
      ...baseSyncDoc,
      sourceExportedAt: null,
      status: 'failed',
      errorMessage,
      newCount: 0,
      changedCount: 0,
      missingCount: 0,
    })
    return
  }

  const existingSnap = await db.collection('items').get()
  const existing: ExistingItem[] = existingSnap.docs.map((d) => {
    const data = d.data()
    return {
      sourceItemId: data.sourceItemId,
      sku: data.sku,
      barcode: data.barcode,
      name: data.name,
      category: data.category,
      priceCentavos: data.priceCentavos,
      vatClass: data.vatClass,
      presentInLatestExport: data.presentInLatestExport,
    }
  })

  const diff = computeCatalogueDiff(payload.items, existing)
  const existingIdToDocId = new Map(existingSnap.docs.map((d) => [d.data().sourceItemId as string, d.id]))

  const batch = db.batch()
  for (const item of diff.newItems) {
    const ref = db.collection('items').doc()
    batch.set(ref, {
      sourceItemId: item.itemId,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      category: item.category,
      priceCentavos: item.priceCentavos,
      vatClass: item.vatClass,
      presentInLatestExport: true,
      reorderPoint: null,
      defaultSupplierId: null,
      unitOfPurchase: null,
      active: true,
      lastSyncedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
  }
  for (const item of diff.changedItems) {
    const docId = existingIdToDocId.get(item.itemId)
    if (!docId) continue
    batch.update(db.collection('items').doc(docId), {
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      category: item.category,
      priceCentavos: item.priceCentavos,
      vatClass: item.vatClass,
      presentInLatestExport: true,
      lastSyncedAt: FieldValue.serverTimestamp(),
    })
  }
  for (const sourceItemId of diff.missingSourceItemIds) {
    const docId = existingIdToDocId.get(sourceItemId)
    if (!docId) continue
    batch.update(db.collection('items').doc(docId), { presentInLatestExport: false, lastSyncedAt: FieldValue.serverTimestamp() })
  }
  await batch.commit()

  await db.collection('catalogueSyncs').add({
    ...baseSyncDoc,
    sourceExportedAt: payload.exportedAt,
    status: 'ok',
    errorMessage: null,
    newCount: diff.newItems.length,
    changedCount: diff.changedItems.length,
    missingCount: diff.missingSourceItemIds.length,
  })
  await db.collection('auditLog').add({
    entity: 'catalogueSync',
    entityId: 'items',
    action: 'sync',
    before: null,
    after: { newCount: diff.newItems.length, changedCount: diff.changedItems.length, missingCount: diff.missingSourceItemIds.length },
    actorId: triggeredBy ?? 'cloud-function:runCatalogueSync',
    actorName: triggeredByName ?? `automatic (${trigger})`,
    at: FieldValue.serverTimestamp(),
    deviceId: `cloud-function:runCatalogueSync:${trigger}`,
    branchId: 'n/a',
  })

  logger.info(`runCatalogueSync (${trigger}): ${diff.newItems.length} new, ${diff.changedItems.length} changed, ${diff.missingSourceItemIds.length} missing`)
}

/** Fires when a shift handover is accepted — the moment the incoming
 *  leader actually takes the shift, not when the pack was generated. A
 *  sync failure here never blocks or reverses the handover: by the time
 *  this trigger runs, `shiftHandovers` already shows `status: 'accepted'`,
 *  and there is no path back from a sync failure to un-accept it. */
export const onShiftHandoverAccepted = onDocumentUpdated(
  { document: 'shiftHandovers/{handoverId}', region: 'asia-southeast1', secrets: [catalogueSyncSecret] },
  async (event) => {
    const before = event.data?.before.data() as { status?: string } | undefined
    const after = event.data?.after.data() as { status?: string; acceptedBy?: string; acceptedByName?: string } | undefined
    if (!after || before?.status === 'accepted' || after.status !== 'accepted') return

    await runCatalogueSync('handover', after.acceptedBy ?? null, after.acceptedByName ?? null, event.params.handoverId)
  },
)

/** Manual override of the same sync the handover trigger runs — for a
 *  manager who changed prices in g7-pos and doesn't want to wait for the
 *  next shift change. Same MANAGER_ROLES gate as closeBusinessDay. */
export const syncCatalogueNow = onCall({ secrets: [catalogueSyncSecret] }, async (request) => {
  requireCallerRole(request.auth, MANAGER_ROLES)
  await runCatalogueSync(
    'manual',
    request.auth!.uid,
    (request.auth!.token.email as string | undefined) ?? request.auth!.uid,
    null,
  )
  return { ok: true }
})
