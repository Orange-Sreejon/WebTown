import { createBuffer, type PixelBuffer } from '../../personal-spaces/paint/pixel-buffer'
import { TRANSPARENT } from '../../personal-spaces/paint/color'

/** Turns pictures into PNG bytes and back. The browser's own encoder by default; tests inject another. */
export interface PngCodec {
  encode(image: PixelBuffer): Promise<ArrayBuffer>
  decode(bytes: ArrayBuffer): Promise<PixelBuffer>
}

function canvasFor(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This browser cannot draw pictures (no canvas).')
  return { canvas, ctx }
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * The browser's PNG encoder and decoder. Every WebTown Paint pixel is fully
 * opaque or fully transparent, so the canvas's premultiplied storage gives back
 * exactly what was drawn; colour conversion is turned off on the way in.
 */
export const browserPngCodec: PngCodec = {
  async encode(image) {
    const { canvas, ctx } = canvasFor(image.width, image.height)
    ctx.putImageData(new ImageData(image.data.slice(), image.width, image.height), 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('The picture could not be turned into a PNG.')
    return blobBytes(blob)
  },
  async decode(bytes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    try {
      const { ctx } = canvasFor(bitmap.width, bitmap.height)
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      const out = createBuffer(bitmap.width, bitmap.height, TRANSPARENT)
      out.data.set(data)
      // A fully transparent pixel is stored as 0,0,0,0 whatever colour it had, exactly as WebTown Paint makes them.
      for (let i = 3; i < out.data.length; i += 4) if (out.data[i] === 0) out.data[i - 3] = out.data[i - 2] = out.data[i - 1] = 0
      return out
    } finally {
      bitmap.close()
    }
  },
}
