// lib/models/listbox-specs.ts
/**
 * The spec columns the Model listbox shows beside each model name, derived from
 * whatever a catalog already publishes. Nothing here adds catalog fields: clip
 * length comes from the duration whitelist, the resolution from the size table,
 * the shape glyphs from the size labels, the price from the rate table. Every
 * catalog names these three things a little differently — the aggregators list
 * sizes, fal and Kie list control fields — so each gets an adapter and the
 * listbox itself only ever sees cells.
 */
import type { ProviderModel, ProviderRate, ProviderSize } from '@/lib/providers/types';
import { sizeTier } from '@/lib/providers/types';
import type { FalInputMode, FalModelDefinition } from '@/lib/fal/types';
import { resolveFalVariant } from '@/lib/fal/catalog';
import type { KieInputMode, KieModelDefinition } from '@/lib/kie/types';
import { resolveKieVariant } from '@/lib/kie/catalog';
import { falRateLabel, geminiRateLabel } from '@/lib/spend/rates';
import type { GeminiImageModel } from '@/lib/engines/gemini-catalog';

export type SpecCell =
  | { kind: 'text'; value: string; tone?: 'muted' | 'subtle' }
  | { kind: 'shapes'; ratios: string[] }
  | { kind: 'mark'; on: boolean; label: string };

export interface SpecColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

const LENGTH: SpecColumn = { key: 'length', label: 'Max', align: 'right' };
const TIER: SpecColumn = { key: 'tier', label: 'Up to', align: 'right' };
const SHAPES: SpecColumn = { key: 'shapes', label: 'Shapes' };
const FROM: SpecColumn = { key: 'from', label: 'From', align: 'right' };
const REFS: SpecColumn = { key: 'refs', label: 'Refs', align: 'right' };
const EDIT: SpecColumn = { key: 'edit', label: 'Edit' };
const SEARCH: SpecColumn = { key: 'search', label: 'Search' };

export const PROVIDER_VIDEO_COLUMNS: SpecColumn[] = [LENGTH, TIER, SHAPES, FROM];
export const PROVIDER_IMAGE_COLUMNS: SpecColumn[] = [FROM, REFS, EDIT];
export const GEMINI_IMAGE_COLUMNS: SpecColumn[] = [FROM, TIER, SEARCH];
export const FAL_VIDEO_COLUMNS: SpecColumn[] = [LENGTH, TIER, SHAPES, FROM];
export const KIE_VIDEO_COLUMNS: SpecColumn[] = [LENGTH, TIER, SHAPES];
export const KIE_IMAGE_COLUMNS: SpecColumn[] = [TIER, SHAPES, REFS];

/** A quiet "not specified": the catalog says nothing, so the cell claims nothing. */
const DASH: SpecCell = { kind: 'text', value: '—', tone: 'subtle' };

const text = (value: string, tone?: 'muted' | 'subtle'): SpecCell => ({ kind: 'text', value, tone });

// ---------------------------------------------------------------- shapes

/** Widest to tallest, the order the glyphs read in. */
const CANONICAL_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '9:21'];

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Vendors quote pixel pairs that are only nearly a named ratio — Sora's
 * 1792×1024 is 1.75, MiniMax's 1344×768 too — so a pair snaps to the nearest
 * canonical ratio within 3% and only an unfamiliar one keeps its raw form.
 */
export function snapRatio(width: number, height: number): string {
  const value = width / height;
  let best: string | undefined;
  let bestError = 0.03;
  for (const ratio of CANONICAL_RATIOS) {
    const error = Math.abs(ratioValue(ratio) - value) / ratioValue(ratio);
    if (error < bestError) {
      best = ratio;
      bestError = error;
    }
  }
  if (best) return best;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/** Dedupe and order ratios widest-first so every row's glyphs line up the same way. */
export function sortRatios(ratios: string[]): string[] {
  const unique = [...new Set(ratios)];
  return unique.sort((a, b) => {
    const ia = CANONICAL_RATIOS.indexOf(a);
    const ib = CANONICAL_RATIOS.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return ratioValue(b) - ratioValue(a);
  });
}

function sizeDims(size: ProviderSize): [number, number] | undefined {
  if (size.width && size.height) return [size.width, size.height];
  const match = size.preset?.match(/^(\d+)\s*[x×]\s*(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/** `720p · 9:16` → 9:16, `1080x1920` → 9:16, `Portrait · 720p` → 9:16, bare `480p` → nothing. */
export function ratioOfSize(size: ProviderSize): string | undefined {
  const explicit = size.label.match(/(\d+)\s*:\s*(\d+)/);
  if (explicit) return `${explicit[1]}:${explicit[2]}`;
  const dims = sizeDims(size);
  if (dims) return snapRatio(dims[0], dims[1]);
  const words = size.label.toLowerCase();
  if (words.includes('square')) return '1:1';
  if (words.includes('portrait')) return '9:16';
  if (words.includes('landscape')) return '16:9';
  return undefined;
}

// ---------------------------------------------------------------- tiers

interface Tier {
  rank: number;
  name: string;
}

const SHORT_SIDE_NAMES: Record<number, string> = {
  480: '480p',
  540: '540p',
  720: '720p',
  768: '768p',
  1080: '1080p',
  1440: '2K',
  2160: '4K',
};

/** `1080p (upscaled)` → 1080p, `768P` → 768p, `2K` → 2K, anything else → nothing. */
export function tierOfText(value: string): Tier | undefined {
  const p = value.match(/(\d{3,4})\s*p\b/i);
  if (p) return { rank: Number(p[1]), name: `${p[1]}p` };
  const k = value.match(/(\d+(?:\.\d+)?)\s*K\b/);
  if (k) return { rank: Number(k[1]) * 1000, name: `${k[1]}K` };
  return undefined;
}

function tierOfSize(size: ProviderSize): Tier | undefined {
  const named = tierOfText(sizeTier(size.label));
  if (named) return named;
  const dims = sizeDims(size);
  if (!dims) return undefined;
  const short = Math.min(...dims);
  const long = Math.max(...dims);
  const name = SHORT_SIDE_NAMES[short];
  // Sora Pro's 1792×1024 is no broadcast tier, so its long side says what it is.
  return name ? { rank: short, name } : { rank: short, name: `${long}px` };
}

function tiersOf(sizes: ProviderSize[] | undefined): Tier[] {
  const byName = new Map<string, Tier>();
  for (const size of sizes ?? []) {
    const tier = tierOfSize(size);
    if (tier && !byName.has(tier.name)) byName.set(tier.name, tier);
  }
  return [...byName.values()].sort((a, b) => a.rank - b.rank);
}

export function topTier(sizes: ProviderSize[] | undefined): string | undefined {
  return tiersOf(sizes).at(-1)?.name;
}

/** `480p–1080p` for a model whose sizes are bare tiers and draw no shape. */
export function tierRange(sizes: ProviderSize[] | undefined): string | undefined {
  const tiers = tiersOf(sizes);
  if (tiers.length === 0) return undefined;
  if (tiers.length === 1) return tiers[0].name;
  return `${tiers[0].name}–${tiers[tiers.length - 1].name}`;
}

// ---------------------------------------------------------------- length and price

export function maxSeconds(model: Pick<ProviderModel, 'durations' | 'duration'>): number | undefined {
  if (model.duration?.type === 'range') return model.duration.max;
  const values = model.duration?.type === 'options' ? model.duration.values : model.durations;
  if (!values || values.length === 0) return undefined;
  return Math.max(...values);
}

/**
 * `0.036` → `$0.036`, `0.1` → `$0.10`, `0.0188` → `$0.0188`.
 * Three places with one trailing zero trimmed, unless the fourth digit is
 * significant — `toFixed(3)` would print P-Video-Edit's $0.0188 draft as $0.019.
 */
function compactUsd(usd: number): string {
  const four = usd.toFixed(4);
  if (!four.endsWith('0')) return `$${four}`;
  const three = usd.toFixed(3);
  return `$${three.endsWith('0') ? three.slice(0, -1) : three}`;
}

const RATE_UNITS: Record<ProviderRate['per'], string> = { second: '/s', image: '/img', video: '/clip' };

function rateFrom(rate: ProviderRate): string {
  const usd = rate.usd ?? Math.min(...Object.values(rate.usdByResolution));
  return `${compactUsd(usd)}${RATE_UNITS[rate.per]}`;
}

/** The first tier of a published price string, tightened: `$0.094 / 5s @ 360p · …` → `$0.094/5s`. */
export function compactPrice(price: string): string {
  return price.split(' · ')[0].split(' @ ')[0].replace(/\s*\/\s*/g, '/');
}

function fromCell(model: Pick<ProviderModel, 'rate' | 'price'>): SpecCell {
  if (model.rate) return text(rateFrom(model.rate));
  if (!model.price) return DASH;
  if (model.price === 'metered') return text('metered', 'subtle');
  return text(compactPrice(model.price));
}

// ---------------------------------------------------------------- adapters

function shapesCell(sizes: ProviderSize[] | undefined, aspectRatios?: string[]): SpecCell {
  const fromSizes = sortRatios((sizes ?? []).map(ratioOfSize).filter((ratio): ratio is string => !!ratio));
  if (fromSizes.length > 0) return { kind: 'shapes', ratios: fromSizes };
  const declared = sortRatios((aspectRatios ?? []).filter((ratio) => ratio !== 'auto'));
  if (declared.length > 0) return { kind: 'shapes', ratios: declared };
  const range = tierRange(sizes);
  return range ? text(range, 'muted') : DASH;
}

function lengthCell(seconds: number | undefined, whenMissing: SpecCell): SpecCell {
  return seconds === undefined ? whenMissing : text(`${seconds}s`);
}

/** Aggregator video rows: Max · Up to · Shapes · From. */
export function providerVideoSpecs(model: ProviderModel, inputMode?: string): SpecCell[] {
  if (inputMode === 'edit' && model.videoEdit) return [text(`${model.videoEdit.maxSeconds}s`), text(model.videoEdit.outputLabel ?? topTier(model.videoEdit.sizes) ?? '—'), text('source'), fromCell({rate:model.videoEdit.draftRate ?? model.videoEdit.rate})];
  return [
    // A video model with no seconds control fixes its own length (LTX 2.3 counts frames).
    lengthCell(maxSeconds(model), text('fixed', 'subtle')),
    topTier(model.sizes) ? text(topTier(model.sizes)!) : DASH,
    shapesCell(model.sizes, model.aspectRatios),
    fromCell(model),
  ];
}

/** Aggregator image rows: From · Refs · Edit. */
export function providerImageSpecs(model: ProviderModel): SpecCell[] {
  return [
    fromCell(model),
    model.maxInputImages === undefined ? DASH : text(String(model.maxInputImages)),
    { kind: 'mark', on: model.modes.includes('image'), label: 'Takes a reference image' },
  ];
}

/**
 * Gemini image rows: From · Up to · Search. The aggregator columns do not fit
 * here — every Gemini model takes the same 14 references and edits — while the
 * two things that actually separate them are the ceiling each reaches (Lite
 * stops at 1K) and whether it can ground on Google Search.
 */
export function geminiImageSpecs(model: GeminiImageModel): SpecCell[] {
  const rate = geminiRateLabel(model.id);
  return [
    // The label spans the resolutions ($0.0336–0.151 / image); the column says
    // where it starts, the same question the aggregator From column answers.
    rate ? text(rate.replace(/^(\$[\d.]+)[–-]\$?[\d.]+/, '$1').replace(/\s*\/\s*/g, '/')) : DASH,
    text(model.sizes[model.sizes.length - 1]),
    { kind: 'mark', on: model.supportsGoogleSearch, label: 'Google Search grounding' },
  ];
}

/** The slice of a fal or Kie control field the columns can be read from. */
interface SpecField {
  key: string;
  type: string;
  options?: Array<{ label: string; value: string | number }>;
  min?: number;
  max?: number;
}

interface FieldSpecs {
  seconds?: number;
  tier?: string;
  ratios: string[];
}

/** Read length, resolution and shapes off a model's control fields. */
export function fieldSpecs(fields: SpecField[]): FieldSpecs {
  const duration = fields.find((field) => field.key === 'duration');
  const resolution = fields.find((field) => field.key === 'resolution');
  const aspect = fields.find((field) => field.key === 'aspect_ratio');

  let seconds: number | undefined;
  if (duration?.type === 'number' && duration.max !== undefined) seconds = duration.max;
  if (duration?.type === 'select') {
    const values = (duration.options ?? []).map((option) => parseFloat(String(option.value))).filter((value) => !Number.isNaN(value));
    if (values.length > 0) seconds = Math.max(...values);
  }

  const tiers = (resolution?.options ?? [])
    .map((option) => tierOfText(option.label))
    .filter((tier): tier is Tier => !!tier)
    .sort((a, b) => a.rank - b.rank);

  const ratios = sortRatios(
    (aspect?.options ?? []).map((option) => String(option.value)).filter((value) => /^\d+:\d+$/.test(value))
  );

  return { seconds, tier: tiers.at(-1)?.name, ratios };
}

function fieldCells(specs: FieldSpecs): SpecCell[] {
  return [
    lengthCell(specs.seconds, DASH),
    specs.tier ? text(specs.tier) : DASH,
    specs.ratios.length > 0 ? { kind: 'shapes', ratios: specs.ratios } : DASH,
  ];
}

/** fal video rows: Max · Up to · Shapes · From, for the variant this mode submits to. */
export function falVideoSpecs(model: FalModelDefinition, inputMode: FalInputMode): SpecCell[] {
  const variant = resolveFalVariant(model.id, 'video', inputMode);
  const cells = fieldCells(fieldSpecs(variant?.fields ?? []));
  const rate = variant ? falRateLabel(variant.endpointId) : null;
  // The label spans a range (`$0.10–0.15 / s`); the column says where it starts.
  const from = rate ? rate.replace(/^(\$[\d.]+)[–-]\$?[\d.]+/, '$1').replace(/\s*\/\s*/g, '/') : undefined;
  return [...cells, from ? text(from) : DASH];
}

/** Kie video rows: Max · Up to · Shapes. */
export function kieVideoSpecs(model: KieModelDefinition, inputMode: KieInputMode): SpecCell[] {
  return fieldCells(fieldSpecs(resolveKieVariant(model.id, inputMode).fields));
}

/** Kie image rows: Up to · Shapes · Refs, where Refs is what the model's edit route takes. */
export function kieImageSpecs(model: KieModelDefinition, inputMode: KieInputMode): SpecCell[] {
  const [, tier, shapes] = fieldCells(fieldSpecs(resolveKieVariant(model.id, inputMode).fields));
  const editRoute = model.variants.find((variant) => variant.inputMode === 'image');
  return [tier, shapes, editRoute?.maxInputImages === undefined ? DASH : text(String(editRoute.maxInputImages))];
}
