// lib/providers/edit-submission.ts
/**
 * The media a fal or Kie run sends, checked before any byte is uploaded.
 *
 * Both catalogs validate a request built from upload URLs, so placeholder URLs
 * stand in for the files: the validator sees the real shape (how many images,
 * which edit role each fills, the source video last) and a refusal costs no
 * upload. Text mode sends nothing, because a reference left in the draft from
 * another mode is not part of that run.
 */
import { materializeEditReferences, packEditReferences, type EditReferenceDraft, type EditReferenceInput, type EditReferencePlan } from './edit-references';
import { validateEditSource, validateEditVideo, type VideoEditCapability } from './video-edit';

const SOURCE_PLACEHOLDER = 'https://source.invalid/video';

export type PreparedSubmissionMedia =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Reference files in upload order. An edit's source video is not among them. */
      files: File[];
      plan?: EditReferencePlan;
      /** Placeholder upload list for the catalog validator; the source is last on an edit. */
      uploadUrls: string[];
      /** The edit's references by role, over the placeholder URLs. */
      references?: EditReferenceInput;
    };

export function prepareSubmissionMedia({
  inputMode,
  references,
  edit,
  source,
  editDraft,
  cloudCap,
}: {
  inputMode: string;
  references: { file: File }[];
  edit?: VideoEditCapability;
  source: { file: File; durationSeconds: number; width: number; height: number } | null;
  editDraft: EditReferenceDraft;
  /** Set for a background job, which attaches at most this many reference images. */
  cloudCap?: number;
}): PreparedSubmissionMedia {
  const isEdit = inputMode === 'edit';
  const editSpec = isEdit ? edit?.references : undefined;
  if (isEdit && !source) return { ok: false, error: 'Choose a source video to edit.' };
  if (isEdit && edit && source) {
    try {
      validateEditVideo(source.file, edit);
      validateEditSource(source, edit);
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : 'Choose a source video this model accepts.' };
    }
  }

  let files = inputMode === 'text' || editSpec ? [] : references.map((reference) => reference.file);
  let plan: EditReferencePlan | undefined;
  if (editSpec) {
    const packed = packEditReferences(editDraft, editSpec);
    if (!packed.ok) return { ok: false, error: packed.error };
    if (cloudCap !== undefined && packed.packed.files.length > cloudCap) {
      return { ok: false, error: `A background job can attach ${cloudCap} reference images. Remove some, or run this edit in the browser.` };
    }
    files = packed.packed.files;
    plan = packed.packed.plan;
  }

  const referenceUrls = files.map((_, index) => `https://reference.invalid/${index}`);
  return {
    ok: true,
    files,
    plan,
    uploadUrls: isEdit ? [...referenceUrls, SOURCE_PLACEHOLDER] : referenceUrls,
    references: editSpec ? { ...materializeEditReferences(editSpec, referenceUrls, plan), video: SOURCE_PLACEHOLDER } : undefined,
  };
}
