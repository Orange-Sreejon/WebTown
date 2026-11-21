/**
 * Test support for WebTown Paint in jsdom, which has no canvas drawing:
 * - a PNG codec that keeps the raw pixels after a real PNG signature and size
 *   header (enough for storage's checks), so saved drawings can be read back
 *   pixel for pixel;
 * - canvas `getContext` returning null quietly, and a fixed on-screen box.
 */
import { TRANSPARENT } from '../../personal-spaces/paint/color'
import { createBuffer, getPixel, type PixelBuffer } from '../../personal-spaces/paint/pixel-buffer'
import type { PngCodec } from './png-codec'

const HEADER = 33

export const testCodec: PngCodec = {
  async encode(image) {
    const bytes = new Uint8Array(HEADER + image.data.length)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, image.width)
    view.setUint32(20, image.height)
    bytes.set(image.data, HEADER)
    return bytes.buffer
  },
  async decode(bytes) {
    const view = new DataView(bytes)
    const out = createBuffer(view.getUint32(16), view.getUint32(20), TRANSPARENT)
    out.data.set(new Uint8Array(bytes, HEADER))
    return out
  },
}

export const decodeTest = (bytes: ArrayBuffer): Promise<PixelBuffer> => testCodec.decode(bytes)
export const pixel = (b: PixelBuffer, x: number, y: number) => getPixel(b, x, y)

/** jsdom: no 2D context (quietly), and the canvas shows at `scale` from the top left of the page. */
export function fakeCanvasLayout(scale = 1): () => void {
  const proto = HTMLCanvasElement.prototype
  const getContext = proto.getContext
  const rect = Element.prototype.getBoundingClientRect
  proto.getContext = (() => null) as typeof proto.getContext
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this instanceof HTMLCanvasElement) {
      return { left: 0, top: 0, x: 0, y: 0, width: this.width * scale, height: this.height * scale, right: this.width * scale, bottom: this.height * scale, toJSON: () => ({}) } as DOMRect
    }
    return rect.call(this)
  }
  return () => {
    proto.getContext = getContext
    Element.prototype.getBoundingClientRect = rect
  }
}
