export type ImageMime = 'image/png' | 'image/webp' | 'image/jpeg'

export function privateImageMime(bytes: Uint8Array): ImageMime | null {
  if (!bytes.length || bytes.length > 524288) return null
  const signature = (offset: number, expected: number[]) => expected.every((value, index) => bytes[offset + index] === value)
  if (signature(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (signature(0, [255, 216, 255]) && signature(bytes.length - 2, [255, 217])) return 'image/jpeg'
  if (bytes.length < 30 || bytes.length > 307200 || !signature(0, [82, 73, 70, 70]) || !signature(8, [87, 69, 66, 80, 86, 80, 56, 32])) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = view.getUint32(16, true)
  if (view.getUint32(4, true) + 8 !== bytes.length || size < 10 || 20 + size + size % 2 !== bytes.length
    || bytes[20] & 1 || !signature(23, [157, 1, 42]) || size % 2 && bytes[bytes.length - 1] !== 0) return null
  const width = view.getUint16(26, true) & 16383
  const height = view.getUint16(28, true) & 16383
  return width >= 1 && height >= 1 && width <= 1024 && height <= 1024 ? 'image/webp' : null
}
