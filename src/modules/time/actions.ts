// Clock in/out and breaks — docs/08-M3-TIME-ROSTER-CERTIFICATION.md §1.
// Clock in/out require a photo; breaks don't (they happen mid-shift, often
// away from the tablet).
import { serverTimestamp } from 'firebase/firestore'
import { useWriteOperational, newDocId } from '@/lib/write'
import { useActiveBranch } from '@/lib/branch'
import { usePinSession } from '@/lib/pin'
import { useAuth } from '@/lib/auth'
import { compressImage } from '@/lib/photo'
import { queuePhotoUpload } from '@/lib/photoQueue'

function currentActor(actor: { userId: string; displayName: string } | null, auth: ReturnType<typeof useAuth>) {
  if (actor) return { userId: actor.userId, userName: actor.displayName }
  if (auth.mode === 'managed') return { userId: auth.user.uid, userName: auth.user.email ?? auth.user.uid }
  return null
}

export function useTimeActions() {
  const { write } = useWriteOperational()
  const activeBranch = useActiveBranch()
  const { actor } = usePinSession()
  const auth = useAuth()

  async function clockEvent(type: 'clock_in' | 'clock_out', photo: Blob): Promise<string> {
    if (!activeBranch) throw new Error('No active branch resolved yet.')
    const who = currentActor(actor, auth)
    if (!who) throw new Error('No actor set.')

    const entryId = newDocId('timeEntries')
    const compressed = await compressImage(photo)
    const photoRef = `branches/${activeBranch.branchId}/time-entries/${entryId}.jpg`
    queuePhotoUpload(entryId, photoRef, compressed)

    return write(
      'timeEntries',
      { userId: who.userId, userName: who.userName, type, at: serverTimestamp(), photoRef, method: 'station' },
      { id: entryId },
    )
  }

  async function breakEvent(type: 'break_start' | 'break_end'): Promise<string> {
    const who = currentActor(actor, auth)
    if (!who) throw new Error('No actor set.')
    return write('timeEntries', {
      userId: who.userId,
      userName: who.userName,
      type,
      at: serverTimestamp(),
      photoRef: null,
      method: 'station',
    })
  }

  return {
    clockIn: (photo: Blob) => clockEvent('clock_in', photo),
    clockOut: (photo: Blob) => clockEvent('clock_out', photo),
    startBreak: () => breakEvent('break_start'),
    endBreak: () => breakEvent('break_end'),
  }
}
