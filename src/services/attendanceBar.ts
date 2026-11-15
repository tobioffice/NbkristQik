import { deflateSync } from "node:zlib";

/**
 * The attendance bar as a real image.
 *
 * Rich messages do not allow inline SVG. They do accept a photo as an
 * uploaded rich-media attachment, so the card gets a rounded bar, a filled
 * portion and the 75% target line instead of a row of characters.
 *
 * Telegram rejects an 18px-tall photo for its aspect ratio, so the bar is
 * centred in a 640x64 transparent canvas. The image is uploaded with the
 * rich message; it is not a public URL.
 */

const BAR_WIDTH = 640;
// Telegram rejects a very short photo for its aspect ratio. At 640x40 the bar
// fills the whole canvas (16:1), so the client has no transparent padding to
// flatten into a white band above and below it.
const IMAGE_HEIGHT = 40;
const BAR_HEIGHT = IMAGE_HEIGHT;
const BAR_RADIUS = Math.floor(IMAGE_HEIGHT / 2);
const BAR_TOP = 0;

const TRACK: readonly [number, number, number, number] = [230, 230, 232, 255];
const GREEN: readonly [number, number, number, number] = [52, 199, 89, 255];
const AMBER: readonly [number, number, number, number] = [255, 159, 10, 255];
const RED: readonly [number, number, number, number] = [255, 59, 48, 255];

type Rgba = readonly [number, number, number, number];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
};

const pixelIndex = (x: number, y: number): number => (y * BAR_WIDTH + x) * 4;

const put = (pixels: Buffer, x: number, y: number, color: Rgba): void => {
  if (x < 0 || x >= BAR_WIDTH || y < 0 || y >= IMAGE_HEIGHT) return;
  const index = pixelIndex(x, y);
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
};

/** A rounded rectangle, drawn one pixel at a time into the bar buffer. */
const roundedRect = (
  pixels: Buffer,
  x0: number,
  width: number,
  height: number,
  radius: number,
  color: Rgba,
): void => {
  const r = Math.max(
    0,
    Math.min(radius, Math.floor(Math.min(width, height) / 2)),
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let inside = true;
      if (r > 0 && x < r && y < r) {
        const dx = r - x - 0.5;
        const dy = r - y - 0.5;
        inside = dx * dx + dy * dy <= r * r;
      } else if (r > 0 && x >= width - r && y < r) {
        const dx = x - (width - r) + 0.5;
        const dy = r - y - 0.5;
        inside = dx * dx + dy * dy <= r * r;
      } else if (r > 0 && x < r && y >= height - r) {
        const dx = r - x - 0.5;
        const dy = y - (height - r) + 0.5;
        inside = dx * dx + dy * dy <= r * r;
      } else if (r > 0 && x >= width - r && y >= height - r) {
        const dx = x - (width - r) + 0.5;
        const dy = y - (height - r) + 0.5;
        inside = dx * dx + dy * dy <= r * r;
      }
      if (inside) put(pixels, x0 + x, BAR_TOP + y, color);
    }
  }
};

/** The RGB fill colour for a percentage. */
const fillColour = (percentage: number, target: number): Rgba => {
  if (percentage >= target) return GREEN;
  if (percentage >= 50) return AMBER;
  return RED;
};

export const renderAttendanceBarPng = ({
  percentage,
  target,
}: {
  percentage: number;
  target: number;
}): Buffer => {
  const pct = Math.max(0, Math.min(100, percentage));
  const at = Math.max(0, Math.min(100, target));
  const pixels = Buffer.alloc(BAR_WIDTH * IMAGE_HEIGHT * 4);
  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    for (let x = 0; x < BAR_WIDTH; x += 1) {
      put(pixels, x, y, TRACK);
    }
  }

  // The track is the whole canvas; the fill is a capsule so a low percentage
  // still ends in a clean round cap.
  const fillWidth = Math.round((BAR_WIDTH * pct) / 100);
  if (fillWidth > 0) {
    roundedRect(
      pixels,
      0,
      Math.max(fillWidth, BAR_HEIGHT),
      BAR_HEIGHT,
      BAR_RADIUS,
      fillColour(pct, at),
    );
  }

  // The target line stays visible over the fill, like the 75% tick in the
  // mock. Two pixels is enough at this height.
  const tickX = Math.round((BAR_WIDTH * at) / 100);
  for (let y = 0; y < BAR_HEIGHT; y += 1) {
    put(pixels, tickX, y, RED);
    put(pixels, tickX + 1, y, RED);
  }

  const raw = Buffer.alloc((BAR_WIDTH * 4 + 1) * IMAGE_HEIGHT);
  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    const rowStart = y * (BAR_WIDTH * 4 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * BAR_WIDTH * 4, (y + 1) * BAR_WIDTH * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(BAR_WIDTH, 0);
  ihdr.writeUInt32BE(IMAGE_HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};
