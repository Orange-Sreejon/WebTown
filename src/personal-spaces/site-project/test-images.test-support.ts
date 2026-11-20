/** Test support: tiny but real image files, as bytes. Used only by tests. */

const fromBase64 = (b64: string): ArrayBuffer => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/** A 1x1 PNG. */
export const PNG_1PX = (): ArrayBuffer =>
  fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')

/** A 1x1 GIF89a. */
export const GIF_1PX = (): ArrayBuffer => fromBase64('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')

/** A two-frame animated GIF (NETSCAPE2.0 loop), 2x2. */
export const GIF_ANIMATED = (): ArrayBuffer =>
  fromBase64('R0lGODlhAgACAPAAAP8AAAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAMgAAACwAAAAAAgACAAACAoRRACH5BAAyAAAALAAAAAACAAIAAAICDFQAOw==')

/** The start of a JPEG (enough for the signature check). */
export const JPEG_HEAD = (): ArrayBuffer => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).buffer

/** A WebP header. */
export const WEBP_HEAD = (): ArrayBuffer => new TextEncoder().encode('RIFF\u0010\u0000\u0000\u0000WEBPVP8 ').buffer as ArrayBuffer

export const svg = (body = '<rect width="10" height="10" fill="red"/>'): ArrayBuffer =>
  new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`).buffer as ArrayBuffer

export const text = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer
