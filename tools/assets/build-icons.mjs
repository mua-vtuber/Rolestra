// Rolestra placeholder app icon generator.
// Produces assets/icon.png (1024x1024), assets/icon.ico, assets/icon.icns
// from a procedurally-drawn source. Re-run after design lands a real icon.
// Usage: node tools/assets/build-icons.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..');
const outDir = resolve(repoRoot, 'assets');

const SIZE = 1024;
const BG = [0x12, 0x16, 0x22, 0xff]; // deep indigo
const FG = [0xf4, 0xea, 0xd4, 0xff]; // warm cream
const ACCENT = [0xe8, 0x6a, 0x4c, 0xff]; // tactical orange
const FRAME = [0x4e, 0x4a, 0x6a, 0xff];

function makeBuffer(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    px[i * 4 + 0] = BG[0];
    px[i * 4 + 1] = BG[1];
    px[i * 4 + 2] = BG[2];
    px[i * 4 + 3] = BG[3];
  }
  return px;
}

function setPixel(px, size, x, y, c) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  px[i + 0] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
  px[i + 3] = c[3];
}

function fillRect(px, size, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(px, size, x, y, c);
  }
}

function strokeRect(px, size, x0, y0, x1, y1, w, c) {
  fillRect(px, size, x0, y0, x1, y0 + w, c);
  fillRect(px, size, x0, y1 - w, x1, y1, c);
  fillRect(px, size, x0, y0, x0 + w, y1, c);
  fillRect(px, size, x1 - w, y0, x1, y1, c);
}

function drawDisc(px, size, cx, cy, r, c) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(px, size, x, y, c);
    }
  }
}

// Stylized "R" mark: stem + bowl arch + diagonal leg, drawn from rectangles + disc.
function drawRMark(px, size) {
  const margin = Math.floor(size * 0.18);
  const stemX = margin;
  const stemW = Math.floor(size * 0.13);
  const top = margin;
  const bottom = size - margin;
  fillRect(px, size, stemX, top, stemX + stemW, bottom, FG);

  const bowlOuterR = Math.floor(size * 0.21);
  const bowlInnerR = Math.floor(size * 0.10);
  const bowlCx = stemX + stemW + bowlOuterR - Math.floor(size * 0.02);
  const bowlCy = top + bowlOuterR;
  drawDisc(px, size, bowlCx, bowlCy, bowlOuterR, FG);
  drawDisc(px, size, bowlCx, bowlCy, bowlInnerR, BG);
  fillRect(px, size, stemX + stemW, bowlCy, bowlCx, bowlCy + bowlOuterR, BG);
  fillRect(px, size, stemX + stemW, top, stemX + stemW + 1, bowlCy + 1, FG);

  const legX0 = stemX + stemW;
  const legY0 = bowlCy + Math.floor(bowlOuterR * 0.3);
  const legX1 = bowlCx + bowlOuterR;
  const legY1 = bottom;
  const legW = stemW;
  const legLen = Math.max(Math.abs(legX1 - legX0), Math.abs(legY1 - legY0));
  for (let t = 0; t < legLen; t += 1) {
    const x = Math.round(legX0 + ((legX1 - legX0) * t) / legLen);
    const y = Math.round(legY0 + ((legY1 - legY0) * t) / legLen);
    fillRect(px, size, x, y, x + legW, y + Math.max(2, Math.floor(legW * 0.5)), FG);
  }
}

function drawCornerBrackets(px, size) {
  const m = Math.floor(size * 0.05);
  const len = Math.floor(size * 0.13);
  const w = Math.max(4, Math.floor(size * 0.012));
  // top-left
  fillRect(px, size, m, m, m + len, m + w, ACCENT);
  fillRect(px, size, m, m, m + w, m + len, ACCENT);
  // top-right
  fillRect(px, size, size - m - len, m, size - m, m + w, ACCENT);
  fillRect(px, size, size - m - w, m, size - m, m + len, ACCENT);
  // bottom-left
  fillRect(px, size, m, size - m - w, m + len, size - m, ACCENT);
  fillRect(px, size, m, size - m - len, m + w, size - m, ACCENT);
  // bottom-right
  fillRect(px, size, size - m - len, size - m - w, size - m, size - m, ACCENT);
  fillRect(px, size, size - m - w, size - m - len, size - m, size - m, ACCENT);
}

function drawIcon(size) {
  const px = makeBuffer(size);
  // outer frame
  const inset = Math.floor(size * 0.035);
  strokeRect(px, size, inset, inset, size - inset, size - inset, Math.max(3, Math.floor(size * 0.008)), FRAME);
  drawCornerBrackets(px, size);
  drawRMark(px, size);
  return px;
}

// PNG encoder (RGBA, 8-bit) — no external deps.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(6, 9); // RGBA color type
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    filtered[y * (stride + 1)] = 0; // filter: None
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(filtered, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function ensureDir(path) {
  // assets dir already created by caller; no-op safeguard kept for self-contained re-runs.
  void path;
}

function main() {
  ensureDir(outDir);
  const px = drawIcon(SIZE);
  const pngBuffer = encodePng(SIZE, SIZE, px);
  const pngPath = resolve(outDir, 'icon.png');
  writeFileSync(pngPath, pngBuffer);
  // png2icons accepts a PNG buffer and emits ICO / ICNS containing
  // resampled sub-images. BICUBIC produces clean placeholder edges.
  const ico = png2icons.createICO(pngBuffer, png2icons.BICUBIC, 0, false, true);
  if (!ico) throw new Error('createICO returned null');
  writeFileSync(resolve(outDir, 'icon.ico'), ico);
  const icns = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
  if (!icns) throw new Error('createICNS returned null');
  writeFileSync(resolve(outDir, 'icon.icns'), icns);

  const hash = createHash('sha256').update(pngBuffer).digest('hex').slice(0, 12);
  console.log(`assets/icon.png  ${pngBuffer.length} bytes  sha256:${hash}`);
  console.log(`assets/icon.ico  ${ico.length} bytes`);
  console.log(`assets/icon.icns ${icns.length} bytes`);
}

main();
