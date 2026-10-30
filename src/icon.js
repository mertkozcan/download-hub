// Generates a small PNG tray icon at runtime (blue rounded tile with a white down-arrow), no asset file needed.
const zlib = require('zlib');
const { nativeImage } = require('electron');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = size * 0.18;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const cx = Math.min(Math.max(x, r), size - 1 - r), cy = Math.min(Math.max(y, r), size - 1 - r);
      const inside = Math.hypot(x - cx, y - cy) <= r;
      const u = x / size, v = y / size;
      const shaft = Math.abs(u - 0.5) < 0.09 && v > 0.2 && v < 0.55;
      const head = v >= 0.5 && v < 0.78 && Math.abs(u - 0.5) < (0.78 - v) * 0.9;
      const bar = v > 0.8 && v < 0.88 && u > 0.22 && u < 0.78;
      const white = shaft || head || bar;
      const c = white ? [255, 255, 255] : [79, 157, 255];
      raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { trayIcon: () => nativeImage.createFromBuffer(png(32)) };
