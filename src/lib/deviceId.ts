// A stable per-installation id, persisted outside IndexedDB so it survives
// even if app storage is cleared — every operational write needs a deviceId.
const STORAGE_KEY = 'g7.deviceId'

export function getDeviceId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
