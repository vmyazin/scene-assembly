/**
 * A source clip already uploaded by the Worker (a YouTube import), keyed by the
 * browser's copy of it so the edit form can stay a plain File.
 *
 * Staging is one-use: upload cleanup deletes an input as soon as every job holding
 * it has finished, so a second submission with the same clip must upload the
 * browser's copy instead of naming a row that may already be gone.
 */
interface StagedSource { uploadId: string; owner: string; expiresAt: number }
const staged = new WeakMap<File, StagedSource>();
/** Submission happens after this check; keep clear of the 24-hour edge. */
const EXPIRY_MARGIN_MS = 300_000;

export function stageSource(file: File, entry: StagedSource): void { staged.set(file, entry); }
export function forgetStagedSource(file: File): void { staged.delete(file); }
export function stagedSourceId(file: File, owner: string, now = Date.now()): string | undefined {
  const entry = staged.get(file);
  return entry && entry.owner === owner && entry.expiresAt - now > EXPIRY_MARGIN_MS ? entry.uploadId : undefined;
}
