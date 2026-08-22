// Client-side compression before any upload — max 1600px, JPEG q0.7
// (docs/01-ARCHITECTURE.md rule 6). Storage cost is dominated by photos.
export async function compressImage(source: Blob, maxDimension = 1600, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))), 'image/jpeg', quality)
    })
  } finally {
    bitmap.close()
  }
}
