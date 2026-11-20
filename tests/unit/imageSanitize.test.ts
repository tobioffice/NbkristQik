import { describe, expect, it } from "vitest";
import {
  sniffImageKind,
  stripImageMetadata,
} from "../../src/services/imageSanitize.js";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([
    length,
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ]);
};

const riffChunk = (fourcc: string, data: Buffer): Buffer => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  const padding = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(fourcc, "ascii"), size, data, padding]);
};

const makePng = (): Buffer =>
  Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", Buffer.alloc(13)),
    pngChunk("eXIf", Buffer.from("GPS=12.9,77.5")),
    pngChunk("tEXt", Buffer.from("comment=private")),
    pngChunk("IDAT", Buffer.from("pixels")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

const makeJpeg = (): Buffer => {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x06]),
    Buffer.from("JFIF"),
  ]);
  const exif = Buffer.concat([
    Buffer.from([0xff, 0xe1, 0x00, 0x09]),
    Buffer.from("ExifGPS"),
  ]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x01, 0x02]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    exif,
    sos,
    Buffer.from([0xff, 0xd9]),
  ]);
};

const makeWebp = (): Buffer => {
  const chunks = Buffer.concat([
    riffChunk("VP8 ", Buffer.from("pixels")),
    riffChunk("EXIF", Buffer.from("GPS")),
    riffChunk("XMP ", Buffer.from("private")),
  ]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(chunks.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, chunks]);
};

describe("image sniffing", () => {
  it("identifies PNG, JPEG and WebP, and nothing else", () => {
    expect(sniffImageKind(makePng())).toBe("png");
    expect(sniffImageKind(makeJpeg())).toBe("jpeg");
    expect(sniffImageKind(makeWebp())).toBe("webp");
    expect(sniffImageKind(Buffer.from("not an image"))).toBeNull();
  });
});

describe("metadata stripping", () => {
  it("drops PNG text and EXIF chunks but keeps the image data", () => {
    const clean = stripImageMetadata(makePng(), "png");
    expect(clean).not.toBeNull();
    expect(clean!.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(clean!.includes(Buffer.from("GPS=12.9,77.5"))).toBe(false);
    expect(clean!.includes(Buffer.from("comment=private"))).toBe(false);
    expect(clean!.includes(Buffer.from("IDAT"))).toBe(true);
    expect(clean!.includes(Buffer.from("IEND"))).toBe(true);
  });

  it("drops JPEG APP1/EXIF while keeping the JFIF header and the scan", () => {
    const clean = stripImageMetadata(makeJpeg(), "jpeg");
    expect(clean).not.toBeNull();
    expect(clean![0]).toBe(0xff);
    expect(clean![1]).toBe(0xd8);
    expect(clean!.includes(Buffer.from("ExifGPS"))).toBe(false);
    expect(clean!.includes(Buffer.from("JFIF"))).toBe(true);
    expect(clean!.includes(Buffer.from([0xff, 0xda]))).toBe(true);
    expect(clean!.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
  });

  it("drops WebP EXIF and XMP chunks and rewrites the RIFF size", () => {
    const clean = stripImageMetadata(makeWebp(), "webp");
    expect(clean).not.toBeNull();
    expect(clean!.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(clean!.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(clean!.includes(Buffer.from("EXIF"))).toBe(false);
    expect(clean!.includes(Buffer.from("XMP "))).toBe(false);
    expect(clean!.includes(Buffer.from("VP8 "))).toBe(true);
    expect(clean!.readUInt32LE(4)).toBe(clean!.length - 8);
  });

  it("rejects a file that does not parse as its claimed container", () => {
    expect(stripImageMetadata(Buffer.from("not a png"), "png")).toBeNull();
    expect(stripImageMetadata(Buffer.from("not a jpeg"), "jpeg")).toBeNull();
    expect(stripImageMetadata(Buffer.from("not a webp"), "webp")).toBeNull();
  });
});
