// lib/providers/edit-references.ts
/**
 * Structured edit references shared by fal, Atlas and Kie.
 *
 * A flat image list cannot say which still is a frontal view, which frame a
 * keyframe pins, or that a lighting sphere is the only image. The plan is
 * indexes into `referenceIds` so the files stay on the existing upload list.
 * Audio stays on `referenceAudioIds`. Absent plan means every reference id is
 * a plain image (or the model's single image role, when it has only one).
 */
import type { EditReferenceSpec, VideoPromptSyntax } from './types';

export interface EditReferencePlan {
  images?: number[];
  elements?: { frontal: number; angles: number[] }[];
  keyframes?: { image: number; index: number }[];
  startImage?: number;
  persons?: number[];
  litSphere?: number;
}

export interface EditReferenceInput {
  video?: string;
  images?: string[];
  elements?: { frontal: string; angles: string[] }[];
  keyframes?: { url: string; index: number }[];
  startImage?: string;
  persons?: string[];
  litSphere?: string;
  audio?: string;
}

export interface EditStill {
  id: string;
  file: File;
  previewUrl: string;
}

export interface EditReferenceDraft {
  images: EditStill[];
  elements: { id: string; frontal: EditStill | null; angles: EditStill[] }[];
  guide: 'start' | 'keyframes';
  startImage: EditStill | null;
  keyframes: { id: string; image: EditStill; index: string }[];
  persons: EditStill[];
  litSphere: EditStill | null;
  audio: { id: string; file: File; name: string } | null;
}

export function emptyEditReferenceDraft(): EditReferenceDraft {
  return {
    images: [],
    elements: [],
    guide: 'start',
    startImage: null,
    keyframes: [],
    persons: [],
    litSphere: null,
    audio: null,
  };
}

/** Background jobs stop at the account reference cap. The browser can go higher. */
export const CLOUD_EDIT_REFERENCE_CAP = 16;

export function editPromptMode(spec?: EditReferenceSpec): 'required' | 'optional' | 'absent' {
  return spec?.prompt ?? 'required';
}

export function editSourceToken(syntax?: VideoPromptSyntax): string {
  if (syntax === 'triple-angle') return '<<<video_1>>>';
  if (syntax === 'at-image-index') return '@Video1';
  return 'the source video';
}

export function editImageToken(syntax: VideoPromptSyntax | undefined, index: number): string {
  const n = index + 1;
  if (syntax === 'triple-angle') return `<<<image_${n}>>>`;
  if (syntax === 'image-index') return `image ${n}`;
  if (syntax === 'at-image-underscore-index') return `@image_${n}`;
  return `@Image${n}`;
}

function take(urls: string[], index: number | undefined): string | undefined {
  if (index === undefined || !Number.isInteger(index) || index < 0 || index >= urls.length) return undefined;
  return urls[index];
}

/**
 * Turn uploaded image URLs into the roles the vendor body needs.
 * Indexes that miss the list become an empty string so validation can refuse them.
 */
export function materializeEditReferences(
  spec: EditReferenceSpec,
  referenceUrls: string[],
  plan?: EditReferencePlan,
  audioUrl?: string,
): EditReferenceInput {
  const input: EditReferenceInput = {};
  if (audioUrl) input.audio = audioUrl;
  if (!plan) {
    if (spec.persons) input.persons = referenceUrls;
    else if (spec.litSphere) input.litSphere = referenceUrls[0];
    else if (spec.keyframes?.startImage && referenceUrls.length === 1) input.startImage = referenceUrls[0];
    else if (spec.images) input.images = referenceUrls;
    else if (referenceUrls.length > 0) input.images = referenceUrls;
    return input;
  }
  if (plan.images?.length) input.images = plan.images.map((index) => take(referenceUrls, index) ?? '');
  if (plan.elements?.length) {
    input.elements = plan.elements.map((element) => ({
      frontal: take(referenceUrls, element.frontal) ?? '',
      angles: element.angles.map((index) => take(referenceUrls, index) ?? ''),
    }));
  }
  if (plan.keyframes?.length) {
    input.keyframes = plan.keyframes.map((frame) => ({
      url: take(referenceUrls, frame.image) ?? '',
      index: frame.index,
    }));
  }
  if (plan.startImage !== undefined) input.startImage = take(referenceUrls, plan.startImage) ?? '';
  if (plan.persons?.length) input.persons = plan.persons.map((index) => take(referenceUrls, index) ?? '');
  if (plan.litSphere !== undefined) input.litSphere = take(referenceUrls, plan.litSphere) ?? '';
  return input;
}

function blank(url: string | undefined): boolean {
  return !url || !url.trim();
}

/** Vendor rules for one edit's references. `null` means the set is acceptable. */
export function editReferenceError(spec: EditReferenceSpec, input: EditReferenceInput): string | null {
  const images = input.images ?? [];
  const elements = input.elements ?? [];
  const persons = input.persons ?? [];
  const keyframes = input.keyframes ?? [];
  if (!spec.images && images.length > 0) return 'This model does not take reference images.';
  if (spec.images && images.length > spec.images.max) {
    return `Add up to ${spec.images.max} reference image${spec.images.max === 1 ? '' : 's'}.`;
  }
  if (images.some(blank)) return 'A reference image is missing.';
  if (!spec.elements && elements.length > 0) return 'This model does not take elements.';
  if (spec.elements) {
    const combined = images.length + elements.length;
    if (combined > spec.elements.combinedMax) {
      return `Reference images and elements together can be at most ${spec.elements.combinedMax}.`;
    }
    for (const [index, element] of elements.entries()) {
      const angles = element.angles.length;
      if (blank(element.frontal) || angles < spec.elements.minAngles || angles > spec.elements.maxAngles || element.angles.some(blank)) {
        return `Element ${index + 1} needs a front view and ${spec.elements.minAngles} to ${spec.elements.maxAngles} angle images.`;
      }
    }
  }
  if (!spec.keyframes && (keyframes.length > 0 || input.startImage)) return 'This model does not take keyframes.';
  if (spec.keyframes) {
    const hasStart = Boolean(input.startImage);
    if (hasStart && keyframes.length > 0) return 'A start frame and keyframes cannot be sent together.';
    if (keyframes.length > spec.keyframes.max) return `Add up to ${spec.keyframes.max} keyframes.`;
    if (input.startImage && !spec.keyframes.startImage) return 'This model does not take a start frame.';
    if (hasStart && blank(input.startImage)) return 'The start frame image is missing.';
    const seen = new Set<number>();
    for (const frame of keyframes) {
      if (blank(frame.url) || !Number.isInteger(frame.index) || frame.index < 0) {
        return 'Each keyframe needs an image and a frame index of 0 or more.';
      }
      if (seen.has(frame.index)) return 'Keyframe indexes must be unique.';
      seen.add(frame.index);
    }
  }
  if (!spec.persons && persons.length > 0) return 'This model does not take per-person photos.';
  if (spec.persons) {
    if (persons.length < spec.persons.min || persons.length > spec.persons.max || persons.some(blank)) {
      return `Add ${spec.persons.min} to ${spec.persons.max} photos, one per person.`;
    }
  }
  if (!spec.litSphere && input.litSphere) return 'This model does not take a lighting sphere.';
  if (spec.litSphere && blank(input.litSphere)) return 'Add the lighting sphere image.';
  if (!spec.audio && input.audio) return 'This model does not take driving audio.';
  return null;
}

export interface PackedEditReferences {
  files: File[];
  plan: EditReferencePlan;
  audio?: File;
}

function pushStill(files: File[], still: EditStill): number {
  const index = files.length;
  files.push(still.file);
  return index;
}

/** Files in `referenceIds` order, plus the plan that names each one's role. */
export function packEditReferences(draft: EditReferenceDraft, spec: EditReferenceSpec): { ok: true; packed: PackedEditReferences } | { ok: false; error: string } {
  const files: File[] = [];
  const plan: EditReferencePlan = {};
  if (spec.images) {
    plan.images = draft.images.map((still) => pushStill(files, still));
  }
  if (spec.elements) {
    plan.elements = draft.elements.map((element) => ({
      frontal: element.frontal ? pushStill(files, element.frontal) : -1,
      angles: element.angles.map((still) => pushStill(files, still)),
    }));
  }
  if (spec.keyframes) {
    if (draft.guide === 'keyframes') {
      plan.keyframes = draft.keyframes.map((frame) => ({
        image: pushStill(files, frame.image),
        index: Number(frame.index),
      }));
    } else if (draft.startImage) {
      plan.startImage = pushStill(files, draft.startImage);
    }
  }
  if (spec.persons) plan.persons = draft.persons.map((still) => pushStill(files, still));
  if (spec.litSphere && draft.litSphere) plan.litSphere = pushStill(files, draft.litSphere);
  const urls = files.map((_, index) => `https://reference.invalid/${index}`);
  const audio = spec.audio && draft.audio ? draft.audio.file : undefined;
  const error = editReferenceError(spec, materializeEditReferences(spec, urls, plan, audio ? 'https://reference.invalid/audio' : undefined));
  if (error) return { ok: false, error };
  return { ok: true, packed: { files, plan, ...(audio ? { audio } : {}) } };
}

export function parseEditReferencePlan(value: unknown, referenceCount: number): EditReferencePlan | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid edit references.');
  const record = value as Record<string, unknown>;
  const allowed = new Set(['images', 'elements', 'keyframes', 'startImage', 'persons', 'litSphere']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new Error('Invalid edit references.');
  const indexes = (raw: unknown, label: string): number[] => {
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= referenceCount)) {
      throw new Error(`Invalid ${label}.`);
    }
    return raw as number[];
  };
  const plan: EditReferencePlan = {};
  if (record.images !== undefined) plan.images = indexes(record.images, 'reference images');
  if (record.persons !== undefined) plan.persons = indexes(record.persons, 'person photos');
  if (record.startImage !== undefined) {
    if (typeof record.startImage !== 'number' || !Number.isInteger(record.startImage)) throw new Error('Invalid start frame.');
    plan.startImage = record.startImage;
  }
  if (record.litSphere !== undefined) {
    if (typeof record.litSphere !== 'number' || !Number.isInteger(record.litSphere)) throw new Error('Invalid lighting sphere.');
    plan.litSphere = record.litSphere;
  }
  if (record.elements !== undefined) {
    if (!Array.isArray(record.elements)) throw new Error('Invalid elements.');
    plan.elements = record.elements.map((element) => {
      if (element === null || typeof element !== 'object' || Array.isArray(element)) throw new Error('Invalid elements.');
      const item = element as Record<string, unknown>;
      const frontal = item.frontal;
      if (typeof frontal !== 'number' || !Number.isInteger(frontal) || frontal < 0 || frontal >= referenceCount) throw new Error('Invalid elements.');
      return { frontal, angles: indexes(item.angles, 'element angles') };
    });
  }
  if (record.keyframes !== undefined) {
    if (!Array.isArray(record.keyframes)) throw new Error('Invalid keyframes.');
    plan.keyframes = record.keyframes.map((frame) => {
      if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('Invalid keyframes.');
      const item = frame as Record<string, unknown>;
      const image = item.image;
      const index = item.index;
      if (typeof image !== 'number' || !Number.isInteger(image) || image < 0 || image >= referenceCount) throw new Error('Invalid keyframes.');
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('Invalid keyframes.');
      return { image, index };
    });
  }
  const used = [
    ...(plan.images ?? []),
    ...(plan.persons ?? []),
    ...(plan.startImage !== undefined ? [plan.startImage] : []),
    ...(plan.litSphere !== undefined ? [plan.litSphere] : []),
    ...(plan.elements ?? []).flatMap((element) => [element.frontal, ...element.angles]),
    ...(plan.keyframes ?? []).map((frame) => frame.image),
  ];
  if (new Set(used).size !== used.length || used.length !== referenceCount) {
    throw new Error('Each reference image must belong to exactly one edit role.');
  }
  return plan;
}

/** Image URLs, then optional driving audio, then the source clip. Matches `jobInputIds`. */
export function splitEditUploads(request: { referenceIds: string[]; referenceVideoIds?: string[]; referenceAudioIds?: string[]; sourceVideoId?: string }, urls: string[]): { images: string[]; audio?: string; source?: string } {
  const images = urls.slice(0, request.referenceIds.length);
  const audioAt = request.referenceIds.length + (request.referenceVideoIds?.length ?? 0);
  const audio = request.referenceAudioIds?.length ? urls[audioAt] : undefined;
  const source = request.sourceVideoId ? urls[urls.length - 1] : undefined;
  return { images, ...(audio ? { audio } : {}), ...(source ? { source } : {}) };
}

/** Vendor body fields for one materialized edit. The source URL is `video`. */
export function editReferenceFields(spec: EditReferenceSpec, input: EditReferenceInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.video) fields.video_url = input.video;
  const images = input.images ?? [];
  if (spec.images && images.length > 0) {
    const wire = spec.images.wire;
    if (wire === 'image_urls') fields.image_urls = images;
    else if (wire === 'images') fields.images = images;
    else fields[wire] = images[0];
  }
  if (spec.elements && input.elements?.length) {
    fields.elements = input.elements.map((element) => ({
      frontal_image_url: element.frontal,
      reference_image_urls: element.angles,
    }));
  }
  if (spec.shotTypeCustomize) fields.shot_type = 'customize';
  if (spec.keyframes) {
    if (input.startImage) fields.start_image_url = input.startImage;
    if (input.keyframes?.length) {
      fields.keyframes = input.keyframes.map((frame) => frame.url);
      fields.keyframe_indexes = input.keyframes.map((frame) => frame.index);
    }
  }
  if (spec.persons && input.persons?.length) fields.reference_image_urls = input.persons;
  if (spec.litSphere && input.litSphere) fields.reference_image_url = input.litSphere;
  if (spec.audio && input.audio) fields.audio = input.audio;
  return fields;
}
