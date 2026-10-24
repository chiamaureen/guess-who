import { deflateSync } from 'node:zlib'
import sharp from 'sharp'

export function pngChunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes])
  let checksum = 0xffffffff
  for (const byte of body) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit++) checksum = checksum >>> 1 ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(bytes.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, body, crc])
}

export function encodeRgbPng(pixels, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1600 || height > 1600 || pixels.length !== width * height * 3) throw new Error('INVALID_PIXELS')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const stride = width * 3
  const rows = Buffer.alloc(height * (stride + 1))
  for (let row = 0; row < height; row++) {
    const output = row * (stride + 1)
    rows[output] = 1
    for (let column = 0; column < stride; column++) rows[output + column + 1] = (pixels[row * stride + column] - (column >= 3 ? pixels[row * stride + column - 3] : 0)) & 255
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))])
}

export async function normalizeQuestionImage(source) {
  if (!source.length || source.length > 32 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE')
  for (const width of [480, 400, 320, 256, 224, 192]) {
    const { data, info } = await sharp(source, { limitInputPixels: 40000000, failOn: 'error' }).rotate().resize({ width, height: Math.round(width * 4 / 3), fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').removeAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true })
    if (info.channels !== 3) throw new Error('INVALID_CHANNELS')
    const png = encodeRgbPng(data, info.width, info.height)
    if (png.length <= 131072) return { png, width: info.width, height: info.height }
  }
  throw new Error('PNG_TOO_LARGE')
}

export async function normalizeQuestionWebp(source) {
  if (!source.length || source.length > 32 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE')
  const metadata = await sharp(source, { limitInputPixels: 40000000, failOn: 'error' }).metadata()
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) throw new Error('UNSUPPORTED_OR_ANIMATED_IMAGE')
  for (const edge of [1024, 800, 640, 480]) {
    const webp = await sharp(source, { limitInputPixels: 40000000, failOn: 'error' }).rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).toColourspace('srgb').webp({ quality: 82, effort: 4 }).toBuffer()
    if (webp.length > 300 * 1024) continue
    const decoded = sharp(webp, { limitInputPixels: 1048576, failOn: 'error' })
    const output = await decoded.metadata()
    await decoded.stats()
    if (output.format !== 'webp' || output.exif || output.icc || output.xmp || output.orientation || output.pages > 1 || Math.max(output.width, output.height) > 1024) throw new Error('UNSAFE_WEBP_OUTPUT')
    return { webp, width: output.width, height: output.height, quality: 82 }
  }
  throw new Error('WEBP_TOO_LARGE')
}
