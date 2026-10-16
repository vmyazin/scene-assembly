// lib/kie/types.ts
import type { VideoEditCapability } from '../providers/video-edit';

export type MediaType = 'image' | 'video';
export type KieInputMode = 'text' | 'image' | 'edit';
export type KieProtocol = 'market' | 'veo';
export type KieFieldType = 'text' | 'number' | 'boolean' | 'select' | 'file';

export interface KieFieldOption {
  label: string;
  value: string | number;
}

export interface KieFieldDefinition {
  key: string;
  label: string;
  type: KieFieldType;
  description?: string;
  defaultValue?: string | number | boolean;
  options?: KieFieldOption[];
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
  required?: boolean;
}

export interface KieModelVariant {
  modelId: string;
  protocol: KieProtocol;
  inputMode: KieInputMode;
  imageInputKey?: string;
  imageInputMultiple?: boolean;
  maxInputImages?: number;
  fields: KieFieldDefinition[];
  /** Present on a video-to-video edit. `price: 'unknown'` means Kie published no dollar rate. */
  edit?: VideoEditCapability;
  price?: 'unknown';
}

export interface KieModelDefinition {
  id: string;
  label: string;
  /** Short code appended to download filenames, e.g. `wan-2_7`. */
  fileCode: string;
  provider: string;
  description: string;
  mediaType: MediaType;
  variants: KieModelVariant[];
}

export interface KieTask {
  taskId: string;
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
  progress?: number;
  resultUrls: string[];
  error?: string;
}

export interface KieJob extends KieTask {
  id: string;
  modelId: string;
  mediaType: MediaType;
  inputMode: KieInputMode;
  protocol: KieProtocol;
  prompt: string;
  /** LLM-derived filename slug for downloads; absent until the model answers. */
  slug?: string;
  /** Controls this ran with, snapshotted so a past run can be restored. */
  controlValues?: Record<string, string | number | boolean>;
  /** Credit balance read just before submit; the ledger bills the drop on success. */
  creditsBefore?: number;
  createdAt: number;
  updatedAt: number;
  pollAttempt: number;
}
