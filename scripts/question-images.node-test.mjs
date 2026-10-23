import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { encodeRgbPng, normalizeQuestionImage } from './lib/question-images.mjs'
import { finalizeQuestionReview } from './finalize-question-review.mjs'

test('minimal PNG round-trips RGB pixels with only IHDR IDAT IEND chunks', async () => {
  const pixels = Buffer.from([12,34,56,78,90,100,110,120,130,140,150,160])
  const png = encodeRgbPng(pixels,2,2)
  assert.deepEqual(await sharp(png).raw().toBuffer(),pixels)
  const types = []
  for (let offset=8;offset<png.length;) {types.push(png.toString('ascii',offset+4,offset+8));offset+=png.readUInt32BE(offset)+12}
  assert.deepEqual(types,['IHDR','IDAT','IEND'])
})
test('photo re-encoding removes EXIF, original descriptions and orientation without adding answer metadata', async () => {
  const jpeg = await sharp({create:{width:20,height:12,channels:3,background:'#8ca4ba'}}).withExif({IFD0:{Artist:'SECRET ANSWER',ImageDescription:'SECRET ANSWER'}}).withMetadata({orientation:6}).jpeg().toBuffer()
  const image = await normalizeQuestionImage(jpeg)
  const metadata = await sharp(image.png).metadata()
  assert.equal(metadata.format,'png');assert.equal(metadata.width,12);assert.equal(metadata.height,20)
  assert.equal(metadata.exif,undefined);assert.equal(metadata.icc,undefined);assert.equal(metadata.orientation,undefined)
  assert.ok(!image.png.includes(Buffer.from('SECRET ANSWER')))
  assert.ok(image.png.length<=131072)
})
test('invalid pixels and undecodable sources fail closed', async () => {
  assert.throws(()=>encodeRgbPng(Buffer.alloc(1),2,2))
  await assert.rejects(normalizeQuestionImage(Buffer.from('not an image')))
  await assert.rejects(normalizeQuestionImage(Buffer.alloc(0)))
})
test('final approval requires explicit completed visual review and named reviewer', async () => {
  await assert.rejects(finalizeQuestionReview('/missing','', 'Codex'),/Explicit/)
  await assert.rejects(finalizeQuestionReview('/missing','--confirm-source-and-visual-review',''),/Explicit/)
})
