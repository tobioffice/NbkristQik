import type { RankScope, SortBy } from "./api";

/**
 * The 9:16 rank card the share sheet previews and the student posts.
 *
 * It is a poster, not a dashboard: one huge rank inside a laurel, a spotlight
 * behind it, and the board's name underneath. The model is deliberately
 * separate from the canvas so every string can be tested in jsdom and the
 * painter only paints. Nothing on the card names a classmate; it carries the
 * caller's own rank and the board's ranked count.
 */

export interface RankCardData {
  sort: SortBy;
  rank: number;
  total: number;
  value: number | null;
  scope: RankScope;
  /** `CSE · Year 3 · Section A`, or `All students`. */
  scopeLabel: string;
}

export interface RankCardModel {
  eyebrow: string;
  /** Just the number; the painter draws the # separately. */
  rank: string;
  /** The number without its unit, e.g. `87.40`. */
  score: string | null;
  unit: "%" | null;
  scopeLabel: string;
  count: string;
  /** `1.9 above the 75% line`, or the mid-mark average note. */
  gapNote: string | null;
  belowMinimum: boolean;
  /** `First in the section` for the top three; null otherwise. */
  merit: string | null;
  /** A crown is drawn for the leader only. */
  crown: boolean;
  alt: string;
}

export const RANK_CARD_WIDTH = 1080;
export const RANK_CARD_HEIGHT = 1920;
export const RANK_CARD_MINIMUM = 75;

const scoreOf = (value: number | null, sort: SortBy): string | null => {
  if (value == null) return null;
  return sort === "attendance" ? value.toFixed(2) : value.toFixed(1);
};

const gapNoteOf = (value: number | null, sort: SortBy): string | null => {
  if (sort === "midmarks") return "Average of M1 and M2";
  if (value == null) return null;
  const diff = Math.round((value - RANK_CARD_MINIMUM) * 10) / 10;
  if (diff === 0) return `On the ${RANK_CARD_MINIMUM}% line`;
  return diff > 0
    ? `${diff.toFixed(1)} above the ${RANK_CARD_MINIMUM}% line`
    : `${Math.abs(diff).toFixed(1)} below the ${RANK_CARD_MINIMUM}% line`;
};

const meritOf = (rank: number, scope: RankScope): string | null => {
  const place =
    rank === 1 ? "First" : rank === 2 ? "Second" : rank === 3 ? "Third" : null;
  if (!place) return null;
  return scope === "section" ? `${place} in the section` : `${place} overall`;
};

export const buildRankCardModel = (data: RankCardData): RankCardModel => {
  const score = scoreOf(data.value, data.sort);
  const unit = data.sort === "attendance" ? "%" : null;
  const belowMinimum =
    data.sort === "attendance" &&
    data.value != null &&
    data.value < RANK_CARD_MINIMUM;
  const count = `${data.total.toLocaleString("en-IN")} ${
    data.total === 1 ? "student" : "students"
  } ranked`;

  return {
    eyebrow: data.sort === "attendance" ? "Attendance rank" : "Mid-mark rank",
    rank: String(data.rank),
    score,
    unit,
    scopeLabel: data.scopeLabel,
    count,
    gapNote: gapNoteOf(data.value, data.sort),
    belowMinimum,
    merit: meritOf(data.rank, data.scope),
    crown: data.rank === 1,
    alt:
      `${data.sort === "attendance" ? "Attendance" : "Mid-mark"} rank card: ` +
      `#${data.rank} of ${data.total} ` +
      (data.scope === "section"
        ? `in ${data.scopeLabel}`
        : "across all students") +
      (score ? `, ${score}${unit ?? ""}` : "") +
      ".",
  };
};

// ---------- painting ----------

const GROUND = "#1a2026";
const TEXT = "#ffffff";
const SECONDARY = "#8794a1";
const ACCENT = "#4cb2ff";
const ACTION = "#248bda";
const DANGER = "#f88277";
const RULE = "#111417";
const FONT = "Figtree, system-ui, sans-serif";

const font = (weight: number, size: number): string =>
  `${weight} ${size}px ${FONT}`;

/** A palette token at a given alpha, for the poster's light and laurel. */
const rgba = (hex: string, alpha: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

const fitSize = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  start: number,
  floor = 28,
): number => {
  let size = start;
  while (size > floor) {
    ctx.font = font(weight, size);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return floor;
};

/** A spotlight behind the rank and a vignette at the edges: depth, not chrome. */
const paintGround = (ctx: CanvasRenderingContext2D): void => {
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, RANK_CARD_WIDTH, RANK_CARD_HEIGHT);

  const glow = ctx.createRadialGradient(540, 820, 60, 540, 820, 780);
  glow.addColorStop(0, rgba(ACTION, 0.22));
  glow.addColorStop(0.5, rgba(ACCENT, 0.07));
  glow.addColorStop(1, rgba(GROUND, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, RANK_CARD_WIDTH, RANK_CARD_HEIGHT);

  const vignette = ctx.createRadialGradient(540, 960, 420, 540, 960, 1180);
  vignette.addColorStop(0, "rgba(8, 11, 15, 0)");
  vignette.addColorStop(0.72, "rgba(8, 11, 15, 0)");
  vignette.addColorStop(1, "rgba(8, 11, 15, 0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, RANK_CARD_WIDTH, RANK_CARD_HEIGHT);
};

/** The rank, enormous and barely there, behind everything. */
const paintGhost = (ctx: CanvasRenderingContext2D, rank: string): void => {
  // A single digit would read as a stray column, not a numeral; a long rank
  // must shrink so it does not read as a clipped accident at the edges.
  if (rank.length < 2) return;
  const size = rank.length >= 4 ? 480 : rank.length === 3 ? 620 : 760;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(800, size);
  ctx.fillStyle = rgba(TEXT, 0.03);
  ctx.fillText(rank, RANK_CARD_WIDTH / 2, 1290);
  ctx.restore();
};

/** Certificate corners: four thin L-brackets. */
const paintCorners = (ctx: CanvasRenderingContext2D): void => {
  const inset = 56;
  const arm = 46;
  const w = RANK_CARD_WIDTH;
  const h = RANK_CARD_HEIGHT;
  ctx.save();
  ctx.strokeStyle = rgba(ACCENT, 0.45);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  const corner = (x: number, y: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * arm);
    ctx.stroke();
  };
  corner(inset, inset, 1, 1);
  corner(w - inset, inset, -1, 1);
  corner(inset, h - inset, 1, -1);
  corner(w - inset, h - inset, -1, -1);
  ctx.restore();
};

const diamond = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void => {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
};

const leaf = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotation: number,
  length: number,
  width: number,
  color: string,
): void => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(0, -length / 2);
  ctx.quadraticCurveTo(width / 2, -length * 0.12, 0, length / 2);
  ctx.quadraticCurveTo(-width / 2, -length * 0.12, 0, -length / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
};

/** Two laurel branches sweeping up from a joined base, open at the top. */
const paintLaurel = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void => {
  const leafColor = rgba(ACCENT, 0.9);
  const stemColor = rgba(ACCENT, 0.5);
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const branches = [
    { from: rad(95), to: rad(240), ccw: false, tilt: -0.55 },
    { from: rad(85), to: rad(-60), ccw: true, tilt: 0.55 },
  ];

  ctx.save();
  for (const branch of branches) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, branch.from, branch.to, branch.ccw);
    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Enough overlapping leaves that each branch reads as one feathery
    // frond, not a ring of ticks.
    const leaves = 12;
    for (let i = 1; i < leaves; i += 1) {
      const t = branch.from + ((branch.to - branch.from) * i) / (leaves - 1);
      const x = cx + radius * Math.cos(t);
      const y = cy + radius * Math.sin(t);
      const tangent = branch.ccw ? t - Math.PI / 2 : t + Math.PI / 2;
      leaf(ctx, x, y, tangent + branch.tilt, 76, 24, leafColor);

      const tm =
        branch.from + ((branch.to - branch.from) * (i - 0.5)) / (leaves - 1);
      const xi = cx + (radius - 18) * Math.cos(tm);
      const yi = cy + (radius - 18) * Math.sin(tm);
      leaf(
        ctx,
        xi,
        yi,
        tangent + branch.tilt * 1.2,
        46,
        16,
        rgba(ACCENT, 0.55),
      );
    }
  }
  diamond(ctx, cx, cy + radius, 9, leafColor);
  ctx.restore();
};

/** A small stroked crown for the leader. */
const paintCrown = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void => {
  const w = 96;
  const h = 62;
  const x0 = cx - w / 2;
  const y0 = cy + h / 2;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, cy - h * 0.12);
  ctx.lineTo(cx - w * 0.25, cy + h * 0.16);
  ctx.lineTo(cx, cy - h / 2);
  ctx.lineTo(cx + w * 0.25, cy + h * 0.16);
  ctx.lineTo(x0 + w, cy - h * 0.12);
  ctx.lineTo(x0 + w, y0);
  ctx.closePath();
  ctx.stroke();
  for (const [px, py] of [
    [x0, cy - h * 0.12],
    [cx, cy - h / 2],
    [x0 + w, cy - h * 0.12],
  ]) {
    ctx.beginPath();
    ctx.arc(px, py - 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const ruleWithDiamond = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  width: number,
): void => {
  ctx.save();
  ctx.strokeStyle = rgba(ACCENT, 0.6);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, y);
  ctx.lineTo(cx - 16, y);
  ctx.moveTo(cx + 16, y);
  ctx.lineTo(cx + width / 2, y);
  ctx.stroke();
  diamond(ctx, cx, y, 8, ACCENT);
  ctx.restore();
};

const drawRank = (
  ctx: CanvasRenderingContext2D,
  rank: string,
  centerX: number,
  baseline: number,
): void => {
  const size = rank.length >= 4 ? 250 : rank.length === 3 ? 320 : 400;
  ctx.font = font(800, size);
  const rankWidth = ctx.measureText(rank).width;
  ctx.font = font(700, Math.round(size * 0.42));
  const hashWidth = ctx.measureText("#").width;
  const gap = 12;
  const left = centerX - (hashWidth + gap + rankWidth) / 2;

  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.fillText("#", left, baseline);
  ctx.font = font(800, size);
  ctx.fillStyle = TEXT;
  ctx.fillText(rank, left + hashWidth + gap, baseline);
};

const drawScore = (
  ctx: CanvasRenderingContext2D,
  model: RankCardModel,
  baseline: number,
): void => {
  if (!model.score) return;

  const scoreSize = 104;
  const unitSize = 42;
  ctx.font = font(700, scoreSize);
  const scoreWidth = ctx.measureText(model.score).width;
  ctx.font = font(500, unitSize);
  const unitWidth = model.unit ? ctx.measureText(model.unit).width : 0;
  const left =
    (RANK_CARD_WIDTH - (scoreWidth + (model.unit ? 4 + unitWidth : 0))) / 2;

  ctx.textAlign = "left";
  ctx.font = font(700, scoreSize);
  ctx.fillStyle = model.belowMinimum ? DANGER : TEXT;
  ctx.fillText(model.score, left, baseline);

  if (model.unit) {
    ctx.font = font(500, unitSize);
    ctx.fillStyle = SECONDARY;
    ctx.fillText(model.unit, left + scoreWidth + 4, baseline);
  }
};

const drawGapNote = (
  ctx: CanvasRenderingContext2D,
  model: RankCardModel,
  baseline: number,
): void => {
  if (!model.gapNote) return;
  ctx.font = font(400, 26);
  const width = ctx.measureText(model.gapNote).width;
  const dot = 10;
  const gap = 14;
  const left = (RANK_CARD_WIDTH - (width + dot + gap)) / 2;

  ctx.beginPath();
  ctx.arc(left + dot / 2, baseline - 9, dot / 2, 0, Math.PI * 2);
  ctx.fillStyle = model.belowMinimum ? DANGER : ACCENT;
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = SECONDARY;
  ctx.fillText(model.gapNote, left + dot + gap, baseline);
};

/** Paint a model onto a 1080×1920 canvas. */
export const drawRankCard = (
  ctx: CanvasRenderingContext2D,
  model: RankCardModel,
): void => {
  paintGround(ctx);
  paintGhost(ctx, model.rank);
  paintCorners(ctx);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = font(700, 44);
  ctx.fillText("NbkristQik", 96, 210);
  ctx.fillStyle = SECONDARY;
  ctx.font = font(400, 26);
  ctx.fillText("Attendance register", 96, 252);

  const cx = RANK_CARD_WIDTH / 2;

  if (model.merit) {
    ctx.textAlign = "center";
    ctx.font = font(600, 30);
    ctx.fillStyle = ACCENT;
    ctx.fillText(model.merit, cx, 470);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = SECONDARY;
  ctx.font = font(500, 32);
  ctx.fillText(model.eyebrow, cx, 540);

  if (model.crown) paintCrown(ctx, cx, 636);

  const radius =
    model.rank.length >= 4 ? 380 : model.rank.length === 3 ? 344 : 310;
  paintLaurel(ctx, cx, 850, radius);
  drawRank(ctx, model.rank, cx, 980);

  const scopeSize = fitSize(ctx, model.scopeLabel, 880, 600, 46);
  ctx.textAlign = "center";
  ctx.font = font(600, scopeSize);
  ctx.fillStyle = TEXT;
  ctx.fillText(model.scopeLabel, cx, 1210);

  ruleWithDiamond(ctx, cx, 1262, 320);

  drawScore(ctx, model, 1360);
  drawGapNote(ctx, model, 1412);

  ctx.textAlign = "center";
  ctx.font = font(400, 26);
  ctx.fillStyle = SECONDARY;
  ctx.fillText(model.count, cx, 1462);

  ctx.fillStyle = RULE;
  ctx.fillRect(96, 1540, RANK_CARD_WIDTH - 192, 1);

  ctx.font = font(600, 34);
  ctx.fillStyle = ACCENT;
  ctx.fillText("See where you stand", cx, 1596);

  ctx.font = font(400, 26);
  ctx.fillStyle = SECONDARY;
  ctx.fillText("t.me/NbkristQik_bot", cx, 1640);
};

const ensureFonts = async (): Promise<void> => {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(font(800, 400)),
    document.fonts.load(font(700, 104)),
    document.fonts.load(font(600, 46)),
    document.fonts.load(font(500, 32)),
    document.fonts.load(font(400, 26)),
  ]).catch(() => undefined);
  await document.fonts.ready.catch(() => undefined);
};

/**
 * Render the card to a JPEG. The phone already has Figtree and the pixels;
 * the server never needs an image library.
 */
export const renderRankCard = async (data: RankCardData): Promise<Blob> => {
  if (typeof document === "undefined") {
    throw new Error("A rank card needs a screen to draw on.");
  }

  const model = buildRankCardModel(data);
  await ensureFonts();

  const canvas = document.createElement("canvas");
  canvas.width = RANK_CARD_WIDTH;
  canvas.height = RANK_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The card could not be drawn.");

  drawRankCard(ctx, model);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  if (!blob) throw new Error("The card could not be saved.");
  return blob;
};
