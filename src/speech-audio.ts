// Builds about one second of silence in every format the speech endpoint can return, without an encoder.

const SAMPLE_RATE = 24000
const SECONDS = 1

function crcMsbFirst(data: Uint8Array, width: 8 | 16, polynomial: number): number {
  const top = 1 << (width - 1)
  const mask = (1 << width) - 1
  let crc = 0
  for (const byte of data) {
    crc ^= byte << (width - 8)
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & top ? ((crc << 1) ^ polynomial) & mask : (crc << 1) & mask
    }
  }
  return crc
}

function oggCrc(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc = (crc ^ (byte << 24)) >>> 0
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1) >>> 0
    }
  }
  return crc
}

export function silentPcm(): Buffer {
  return Buffer.alloc(SAMPLE_RATE * 2 * SECONDS)
}

export function silentWav(): Buffer {
  const pcm = silentPcm()
  const header = Buffer.alloc(44)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono, no padding: every frame is 417 bytes and all-zero side info and data decode to silence.
export function silentMp3(): Buffer {
  const frame = Buffer.alloc(417)

  frame.set([0xff, 0xfb, 0x90, 0xc4])

  const frameCount = Math.ceil((44100 * SECONDS) / 1152)

  return Buffer.concat(Array.from({ length: frameCount }, () => frame))
}

const FLAC_BLOCK_SIZE = 4096

// One mono 16-bit frame holding a single constant-zero subframe.
export function silentFlac(): Buffer {
  const header = Buffer.from([0xff, 0xf8, 0xc7, 0x08, 0x00])
  const frameHeader = Buffer.concat([header, Buffer.from([crcMsbFirst(header, 8, 0x07)])])
  const subframe = Buffer.from([0x00, 0x00, 0x00])
  const unchecked = Buffer.concat([frameHeader, subframe])
  const crc = Buffer.alloc(2)

  crc.writeUInt16BE(crcMsbFirst(unchecked, 16, 0x8005))

  const frame = Buffer.concat([unchecked, crc])

  const streamInfo = Buffer.alloc(34)

  streamInfo.writeUInt16BE(FLAC_BLOCK_SIZE, 0)
  streamInfo.writeUInt16BE(FLAC_BLOCK_SIZE, 2)
  streamInfo.writeUIntBE(frame.length, 4, 3)
  streamInfo.writeUIntBE(frame.length, 7, 3)
  streamInfo.writeBigUInt64BE(
    (BigInt(SAMPLE_RATE) << 44n) | (0n << 41n) | (15n << 36n) | BigInt(FLAC_BLOCK_SIZE),
    10,
  )

  return Buffer.concat([
    Buffer.from('fLaC'),
    Buffer.from([0x80, 0x00, 0x00, streamInfo.length]),
    streamInfo,
    frame,
  ])
}

const OGG_SERIAL = 0x6d6f636b
const OPUS_PRE_SKIP = 312
const OPUS_SAMPLES_PER_PACKET = 960
// A 20 ms CELT fullband silence frame.
const OPUS_SILENCE_PACKET = Buffer.from([0xf8, 0xff, 0xfe])

function oggPage(
  headerType: number,
  granulePosition: bigint,
  sequence: number,
  packets: Buffer[],
): Buffer {
  const header = Buffer.alloc(27 + packets.length)

  header.write('OggS', 0)
  header.writeUInt8(headerType, 5)
  header.writeBigUInt64LE(granulePosition, 6)
  header.writeUInt32LE(OGG_SERIAL, 14)
  header.writeUInt32LE(sequence, 18)
  header.writeUInt8(packets.length, 26)
  packets.forEach((packet, index) => header.writeUInt8(packet.length, 27 + index))

  const page = Buffer.concat([header, ...packets])

  page.writeUInt32LE(oggCrc(page), 22)

  return page
}

export function silentOpus(): Buffer {
  const head = Buffer.alloc(19)

  head.write('OpusHead', 0)
  head.writeUInt8(1, 8)
  head.writeUInt8(1, 9)
  head.writeUInt16LE(OPUS_PRE_SKIP, 10)
  head.writeUInt32LE(SAMPLE_RATE, 12)

  const vendor = 'mock-openai-api'
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)

  tags.write('OpusTags', 0)
  tags.writeUInt32LE(vendor.length, 8)
  tags.write(vendor, 12)

  const packetCount = Math.ceil((48000 * SECONDS) / OPUS_SAMPLES_PER_PACKET)
  const audioPackets = Array.from({ length: packetCount }, () => OPUS_SILENCE_PACKET)
  const granule = BigInt(OPUS_PRE_SKIP + packetCount * OPUS_SAMPLES_PER_PACKET)

  return Buffer.concat([
    oggPage(0x02, 0n, 0, [head]),
    oggPage(0x00, 0n, 1, [tags]),
    oggPage(0x04, granule, 2, audioPackets),
  ])
}

const AAC_SAMPLES_PER_FRAME = 1024
// A mono AAC-LC raw data block: one empty single channel element followed by the end element.
const AAC_SILENCE_BLOCK = Buffer.from([0x00, 0x00, 0x00, 0x07])

export function silentAac(): Buffer {
  const length = 7 + AAC_SILENCE_BLOCK.length
  // MPEG-4, no CRC, AAC-LC, 24 kHz (index 6), mono, variable bit rate, one block per frame.
  const header = Buffer.from([
    0xff,
    0xf1,
    0x58,
    0x40 | (length >> 11),
    (length >> 3) & 0xff,
    ((length & 0x07) << 5) | 0x1f,
    0xfc,
  ])
  const frame = Buffer.concat([header, AAC_SILENCE_BLOCK])
  const frameCount = Math.ceil((SAMPLE_RATE * SECONDS) / AAC_SAMPLES_PER_FRAME)

  return Buffer.concat(Array.from({ length: frameCount }, () => frame))
}
