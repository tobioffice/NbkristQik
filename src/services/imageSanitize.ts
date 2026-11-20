/**
 * Image sniffing and metadata stripping for public question-paper photos.
 *
 * A phone photo can carry EXIF GPS, a device name and a thumbnail in its
 * header. The bank is public, so those bytes never leave the service: the
 * uploaded file is rewritten without the metadata chunks before it is stored.
 * The function only removes container metadata — it never decodes or re-encodes
 * pixels, so the picture the student chose is the picture the bank serves.
 *
 * Supported formats are the same as the issue screenshots: PNG, JPEG and WebP.
 * A file that does not parse cleanly is rejected rather than served as a
 * possibly malformed image.
 */

export type ImageKind = "png" | "jpeg" | "webp";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** Identify an image by its first bytes, never by its filename. */
export const sniffImageKind = (head: Buffer): ImageKind | null => {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

/**
 * JPEG is a sequence of marker segments up to the start-of-scan marker; the
 * scan data after it is entropy-coded and has no metadata segments. Drop APP1
 * (EXIF/XMP), APP13 (IPTC) and COM (comment), keep everything else, and copy
 * the scan through to the end untouched.
 */
const stripJpeg = (bytes: Buffer): Buffer | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const parts: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;

  while (offset < bytes.length) {
    if (offset + 2 > bytes.length || bytes[offset] !== 0xff) return null;

    const markerOffset = offset;
    let marker = bytes[offset + 1];
    // A marker may be preceded by any number of 0xFF fill bytes.
    while (marker === 0xff) {
      offset++;
      if (offset + 2 > bytes.length) return null;
      marker = bytes[offset + 1];
    }

    // Standalone markers carry no length: SOI, TEM and the RSTn family.
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      parts.push(bytes.subarray(markerOffset, offset + 2));
      offset += 2;
      continue;
    }

    if (marker === 0xd9) {
      parts.push(bytes.subarray(markerOffset, offset + 2));
      return Buffer.concat(parts);
    }

    if (offset + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const end = offset + 2 + length;
    if (end > bytes.length) return null;

    // SOS starts the compressed scan; the rest is not a marker sequence.
    if (marker === 0xda) {
      parts.push(bytes.subarray(markerOffset));
      return Buffer.concat(parts);
    }

    const dropMetadata = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!dropMetadata) parts.push(bytes.subarray(markerOffset, end));
    offset = end;
  }

  return null;
};

/**
 * PNG chunks: drop the metadata chunks (eXIf, the tEXt/zTXt/iTXt family and
 * tIME) while keeping the colour chunks, the image data and the CRC bytes.
 */
const stripPng = (bytes: Buffer): Buffer | null => {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }

  const parts: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > 0x7fffffff) return null;
    const end = offset + 12 + length;
    if (end > bytes.length) return null;

    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dropMetadata =
      type === "eXIf" ||
      type === "tEXt" ||
      type === "zTXt" ||
      type === "iTXt" ||
      type === "tIME";
    if (!dropMetadata) parts.push(bytes.subarray(offset, end));

    offset = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }

  return sawEnd ? Buffer.concat(parts) : null;
};

/**
 * WebP is a RIFF container. Drop the EXIF and XMP chunks and rewrite the RIFF
 * size so the file stays a valid container.
 */
const stripWebp = (bytes: Buffer): Buffer | null => {
  if (
    bytes.length < 12 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return null;
  }

  const declaredEnd = bytes.readUInt32LE(4) + 8;
  const limit = Math.min(bytes.length, declaredEnd);
  if (limit < 20) return null;

  const parts: Buffer[] = [];
  let offset = 12;

  while (offset + 8 <= limit) {
    const fourcc = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const padded = size + (size % 2);
    const end = offset + 8 + padded;
    if (end > limit) return null;

    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      parts.push(bytes.subarray(offset, end));
    }
    offset = end;
  }

  if (offset !== limit) return null;

  const body = Buffer.concat(parts);
  if (body.length === 0) return null;

  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
};

/** Rewrite an image without its metadata; null means the file is not usable. */
export const stripImageMetadata = (
  bytes: Buffer,
  kind: ImageKind,
): Buffer | null => {
  if (kind === "png") return stripPng(bytes);
  if (kind === "jpeg") return stripJpeg(bytes);
  return stripWebp(bytes);
};
