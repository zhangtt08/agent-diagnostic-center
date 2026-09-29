/**
 * 生成应用图标：纯 Node 绘制 PNG 像素，再封装为 Windows .ico。
 * 不依赖任何图像库。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'assets');

const SIZE = 256;
const RADIUS = 58;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const neg = s1 < 0 || s2 < 0 || s3 < 0;
  const pos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(neg && pos);
}

function roundedRectAlpha(x, y, size, radius) {
  const left = 8;
  const top = 8;
  const side = size - 16;
  if (x < left || y < top || x > left + side || y > top + side) return 0;
  const dx = Math.max(left + radius - x, x - (left + side - radius), 0);
  const dy = Math.max(top + radius - y, y - (top + side - radius), 0);
  if (dx === 0 || dy === 0) return 1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= radius) return 1;
  const edge = dist - radius;
  return edge >= 1.2 ? 0 : Math.max(0, 1 - edge / 1.2);
}

function renderPixels() {
  const outer = [[128, 46], [204, 196], [52, 196]];
  const inner = [[128, 104], [170, 186], [86, 186]];
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = (y * SIZE + x) * 4;
      const cover = roundedRectAlpha(x, y, SIZE, RADIUS);
      if (cover === 0) continue;
      const t = (x + y) / (2 * SIZE);
      let r = lerp(96, 29, t);
      let g = lerp(165, 78, t);
      let b = lerp(250, 216, t);
      let a = cover * 255;
      if (inTriangle(x, y, ...outer)) {
        if (inTriangle(x, y, ...inner)) {
          r = 29; g = 78; b = 216;
        } else {
          r = 255; g = 255; b = 255;
        }
        a = cover * 255;
      }
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = Math.round(a);
    }
  }
  return data;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y += 1) {
    raw[o++] = 0;
    rgba.copy(raw, o, y * width * 4, (y + 1) * width * 4);
    o += width * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function downscale(rgba, size, target) {
  const out = Buffer.alloc(target * target * 4);
  const ratio = size / target;
  for (let y = 0; y < target; y += 1) {
    for (let x = 0; x < target; x += 1) {
      const sx = Math.min(size - 1, Math.floor((x + 0.5) * ratio));
      const sy = Math.min(size - 1, Math.floor((y + 0.5) * ratio));
      rgba.copy(out, (y * target + x) * 4, (sy * size + sx) * 4, (sy * size + sx) * 4 + 4);
    }
  }
  return out;
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16 * entries.length;
  let offset = header.length + dirSize;
  const dirs = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = entry.width >= 256 ? 0 : entry.width;
    dir[1] = entry.height >= 256 ? 0 : entry.height;
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.data.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    offset += entry.data.length;
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.data)]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const pixels = renderPixels();
const png256 = encodePng(SIZE, SIZE, pixels);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = buildIco([
  ...sizes.filter((s) => s < 256).map((s) => ({ width: s, height: s, data: encodePng(s, s, downscale(pixels, SIZE, s)) })),
  { width: 256, height: 256, data: png256 },
]);

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png256);
fs.writeFileSync(path.join(OUT_DIR, 'icon-32.png'), encodePng(32, 32, downscale(pixels, SIZE, 32)));
console.log(`图标已生成：assets/icon.ico (${(ico.length / 1024).toFixed(1)} KB, ${sizes.length} 个尺寸)`);
