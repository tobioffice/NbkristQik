import type { RankScope, SortBy } from "./api";

/**
 * The 9:16 rank card the share sheet previews and the student posts.
 *
 * The model is deliberately separate from the canvas: every string and
 * percentage can be tested in jsdom, and the painter only paints. Nothing on
 * the card names a classmate; it carries the caller's own rank and the
 * board's ranked count.
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
  showBar: boolean;
  barPercent: number;
  belowMinimum: boolean;
  alt: string;
}

export const RANK_CARD_WIDTH = 1080;
export const RANK_CARD_HEIGHT = 1920;
export const RANK_CARD_MINIMUM = 75;

const scoreOf = (value: number | null, sort: SortBy): string | null => {
  if (value == null) return null;
  return sort === "attendance" ? value.toFixed(2) : value.toFixed(1);
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
    showBar: data.sort === "attendance" && data.value != null,
    barPercent: Math.max(0, Math.min(100, data.value ?? 0)),
    belowMinimum,
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
const DANGER = "#f88277";
const TRACK = "#2d3a47";
const RULE = "#111417";
const FONT = "Figtree, system-ui, sans-serif";

const font = (weight: number, size: number): string =>
  `${weight} ${size}px ${FONT}`;

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

const rounded = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const drawRank = (
  ctx: CanvasRenderingContext2D,
  rank: string,
  centerX: number,
  baseline: number,
): void => {
  const size = rank.length >= 4 ? 200 : 280;
  ctx.font = font(700, size);
  const rankWidth = ctx.measureText(rank).width;
  ctx.font = font(600, Math.round(size * 0.5));
  const hashWidth = ctx.measureText("#").width;
  const gap = 10;
  const left = centerX - (hashWidth + gap + rankWidth) / 2;

  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.fillText("#", left, baseline);
  ctx.font = font(700, size);
  ctx.fillStyle = TEXT;
  ctx.fillText(rank, left + hashWidth + gap, baseline);
};

const drawScore = (
  ctx: CanvasRenderingContext2D,
  model: RankCardModel,
): void => {
  if (!model.score) return;

  const scoreSize = 120;
  const unitSize = 48;
  ctx.font = font(700, scoreSize);
  const scoreWidth = ctx.measureText(model.score).width;
  ctx.font = font(500, unitSize);
  const unitWidth = model.unit ? ctx.measureText(model.unit).width : 0;
  const left =
    (RANK_CARD_WIDTH - (scoreWidth + (model.unit ? 4 + unitWidth : 0))) / 2;

  ctx.textAlign = "left";
  ctx.font = font(700, scoreSize);
  ctx.fillStyle = model.belowMinimum ? DANGER : TEXT;
  ctx.fillText(model.score, left, 1150);

  if (model.unit) {
    ctx.font = font(500, unitSize);
    ctx.fillStyle = SECONDARY;
    ctx.fillText(model.unit, left + scoreWidth + 4, 1150);
  }
};

const drawBar = (ctx: CanvasRenderingContext2D, model: RankCardModel): void => {
  if (!model.showBar) return;

  const width = 760;
  const height = 12;
  const left = (RANK_CARD_WIDTH - width) / 2;
  const top = 1220;

  rounded(ctx, left, top, width, height, height / 2);
  ctx.fillStyle = TRACK;
  ctx.fill();

  const fillWidth = Math.max(
    height,
    Math.round((width * model.barPercent) / 100),
  );
  rounded(ctx, left, top, fillWidth, height, height / 2);
  ctx.fillStyle = TEXT;
  ctx.fill();

  // The 75% min is the register's own line, and the only red on the card.
  const tick = left + Math.round(width * (RANK_CARD_MINIMUM / 100));
  ctx.fillStyle = DANGER;
  ctx.fillRect(tick, top - 10, 4, height + 20);

  ctx.textAlign = "center";
  ctx.font = font(400, 26);
  ctx.fillStyle = SECONDARY;
  ctx.fillText(
    `${RANK_CARD_MINIMUM}% minimum`,
    Math.min(left + width - 72, Math.max(left + 72, tick)),
    top + 62,
  );
};

/** Paint a model onto a 1080×1920 canvas. */
export const drawRankCard = (
  ctx: CanvasRenderingContext2D,
  model: RankCardModel,
): void => {
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, RANK_CARD_WIDTH, RANK_CARD_HEIGHT);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = font(700, 46);
  ctx.fillText("NbkristQik", 96, 320);
  ctx.fillStyle = SECONDARY;
  ctx.font = font(400, 28);
  ctx.fillText("Attendance register", 96, 364);

  ctx.textAlign = "center";
  ctx.fillStyle = SECONDARY;
  ctx.font = font(500, 40);
  ctx.fillText(model.eyebrow, RANK_CARD_WIDTH / 2, 620);

  drawRank(ctx, model.rank, RANK_CARD_WIDTH / 2, 900);

  const scopeSize = fitSize(ctx, model.scopeLabel, 880, 600, 48);
  ctx.textAlign = "center";
  ctx.font = font(600, scopeSize);
  ctx.fillStyle = TEXT;
  ctx.fillText(model.scopeLabel, RANK_CARD_WIDTH / 2, 1010);

  drawScore(ctx, model);
  drawBar(ctx, model);

  ctx.textAlign = "center";
  ctx.font = font(400, 34);
  ctx.fillStyle = SECONDARY;
  ctx.fillText(model.count, RANK_CARD_WIDTH / 2, 1360);

  ctx.fillStyle = RULE;
  ctx.fillRect(96, 1420, RANK_CARD_WIDTH - 192, 1);

  ctx.font = font(500, 36);
  ctx.fillStyle = ACCENT;
  ctx.fillText("See where you stand", RANK_CARD_WIDTH / 2, 1480);

  ctx.font = font(400, 28);
  ctx.fillStyle = SECONDARY;
  ctx.fillText("t.me/NbkristQik_bot", RANK_CARD_WIDTH / 2, 1522);
};

const ensureFonts = async (): Promise<void> => {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(font(700, 280)),
    document.fonts.load(font(600, 120)),
    document.fonts.load(font(500, 40)),
    document.fonts.load(font(400, 28)),
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
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
  if (!blob) throw new Error("The card could not be saved.");
  return blob;
};
