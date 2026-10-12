// lib/describe-source/prompt.ts

import { INJECTION_GUARD } from '@/lib/micro-ai/tasks';

import type { DescribePart } from '@/lib/describe-source/contract';

/**
 * A source description is a prompt the person will edit, then send to a video
 * model that never sees the file. It has to say what is actually there —
 * subject, motion, camera, light — and stop. It does not invent a shoot, and
 * it does not try to hide what the picture shows.
 */
const VIDEO_SYSTEM = [
  'You write a video-generation prompt from source media. The reader will edit',
  'your paragraph, then send it to a video model that never sees the file —',
  'only your words.',
  '',
  'Describe only what is visible. Cover, in one paragraph: subject and',
  'appearance, the action from start to finish, setting, camera behavior,',
  'lighting and color, and pacing. Use concrete visual language.',
  'If the source is a still image, describe the picture and do not invent',
  'motion, dialogue, names, or events that are not visible.',
  'If the source is a video or ordered stills from one video, describe how',
  'the scene changes from the first moment to the last.',
  '',
  'OUTPUT FORMAT:',
  '- One paragraph, 40-120 words.',
  '- No title, no markdown, no quotes, no bullet list, no preamble.',
  INJECTION_GUARD,
].join('\n');

const IMAGE_SYSTEM = VIDEO_SYSTEM.replace(
  'You write a video-generation prompt from source media.',
  'You write an image-generation prompt from source media.'
);

/** Lines that are chatter, a leaked instruction, or a refusal — never a prompt. */
const DISCARDED_LINE = [
  /^(here|sure|okay|certainly|of course)\b/i,
  /^(prompt|description|example|output|title|note|answer)\s*\d*\s*[:.]/i,
  /^(rules?|output format|system|instructions?)\b/i,
  /^[-*#>]+\s*$/,
  /ignore (all )?(previous|prior|above)/i,
  /system prompt/i,
  /\b(i cannot|i can't|i'm sorry|as an ai)\b/i,
];

const SAFE_LABEL = /^(Source video|Image [1-6]|First frame|Last frame|\d+\.\ds)$/;

/** A client-supplied label is a caption, never instructions. Unknown text is replaced. */
export function safeLabel(label: string, mimeType: string, index: number): string {
  const trimmed = label.trim();
  if (SAFE_LABEL.test(trimmed)) return trimmed;
  if (mimeType.startsWith('video/')) return 'Source video';
  return `Image ${Math.min(index + 1, 6)}`;
}

export function describeUserBrief(parts: Array<Pick<DescribePart, 'mimeType' | 'label'>>): string {
  const labels = parts.map((part, index) => safeLabel(part.label, part.mimeType, index));
  const video = parts.length === 1 && parts[0].mimeType.startsWith('video/');
  const stills = parts.length > 0 && labels.every((label) => /^\d+\.\ds$/.test(label));
  if (video) {
    return 'The attachment is one source video. Describe it as a video-generation prompt.';
  }
  if (stills) {
    return `The attachments are ordered stills from one source video (${labels.join(', ')}). Describe the clip they come from, including how it changes from the first still to the last.`;
  }
  return `The attachments are the source (${labels.join(', ')}). Describe them as one scene a video model can restage.`;
}

export interface DescribeTaskSpec {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  validate: (raw: string) => string | null;
}

export function describeSourceTask(
  parts: DescribePart[],
  target: 'video' | 'image' = 'video'
): DescribeTaskSpec {
  return {
    system: target === 'image' ? IMAGE_SYSTEM : VIDEO_SYSTEM,
    user: describeUserBrief(parts),
    temperature: 0.4,
    maxTokens: 400,
    timeoutMs: 25_000,
    validate: validateDescription,
  };
}

/**
 * Keep a paragraph that reads like a prompt. Preamble, refusals, and leaked
 * instructions are dropped; what remains has to be long enough to direct a
 * generation and short enough to edit in the prompt box.
 */
function cleanLine(line: string): string {
  let next = line.replace(/[*_`#]+/g, '').trim();
  // A model often wraps the answer as `Prompt: "..."`. Each pass removes one
  // layer; a real sentence stops changing.
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = next
      .replace(/^[-*\d.)\s]+/, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(prompt|description|example)\s*:\s*/i, '')
      .trim();
    if (stripped === next) break;
    next = stripped;
  }
  return next;
}

export function validateDescription(raw: string): string | null {
  const lines = raw
    .split('\n')
    .map(cleanLine)
    .filter((line) => line.length > 0 && !DISCARDED_LINE.some((pattern) => pattern.test(line)));

  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!text || DISCARDED_LINE.some((pattern) => pattern.test(text))) return null;
  const words = text.split(/\s+/).length;
  if (words < 20 || words > 180 || text.length > 1600) return null;
  return text;
}
