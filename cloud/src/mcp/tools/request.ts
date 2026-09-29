import * as z from 'zod';
import type { CloudJobRequest } from '../../../../lib/account/contracts';
import { checkReferences, checkValues, findModelDescriptor, providerLabel, type AgentProvider, type ModeDescriptor, type ModelDescriptor } from '../../../../lib/account/model-schema';
import { formatUsd, formatUsdTotal } from '../../../../lib/spend/format';
import type { SpendFigure } from '../../../../lib/spend/resolve';
import { CLOUD_PROVIDERS, enabledProviders, validateRequest } from '../../providers';
import { listConnections } from '../../vault';
import type { ChargeOutcome } from '../budget';
import { ToolError } from '../errors';
import type { ToolContext } from '../tool';
import type { Env } from '../../security';

export const referenceSchema = z.union([
  z.object({ uploadId: z.string().min(1).max(128).describe('An id returned by add_reference.') }),
  z.object({ assetId: z.string().min(1).max(128).describe('A library asset id, from list_assets or get_job.') }),
]);
export type ReferenceInput = z.infer<typeof referenceSchema>;

export const requestShape = {
  provider: z.enum(CLOUD_PROVIDERS).describe('A provider from list_models.'),
  modelId: z.string().min(1).max(256).describe('The model id exactly as list_models gives it.'),
  mediaType: z.enum(['image', 'video']),
  inputMode: z.enum(['text', 'image', 'frames', 'reference', 'edit']).describe('One of the modes list_models lists for this model.'),
  prompt: z.string().min(1).max(20_000),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe('Settings by field key. Omitted keys take the model\'s defaults.'),
  references: z.array(referenceSchema).max(16).optional().describe('Reference images, in order.'),
  sourceVideo: referenceSchema.optional().describe('The clip to edit, in edit mode only.'),
};
const requestObject = z.object(requestShape);
export type RequestInput = z.infer<typeof requestObject>;

export interface PreparedRequest { request: CloudJobRequest; model: ModelDescriptor; mode: ModeDescriptor }

export async function connectedProviders(env: Env, userId: string): Promise<string[]> {
  return (await listConnections(env, userId)).map(row => (row as { provider: string }).provider);
}

/**
 * Everything generate and estimate_cost agree on before money is involved:
 * the provider is usable, the model and mode exist, the settings are valid and
 * have their defaults written in, the reference count fits, and the Worker's
 * own validateRequest accepts it. Reference ids are placeholders until generate
 * resolves the real uploads.
 */
export async function prepareRequest(ctx: ToolContext, input: RequestInput): Promise<PreparedRequest> {
  const { env, agent } = ctx;
  const provider = input.provider as AgentProvider;
  if (!enabledProviders(env).includes(provider)) throw new ToolError('provider_unavailable', `${providerLabel(provider)} is not available for background generation.`);
  if (!(await connectedProviders(env, agent.user_id)).includes(provider)) {
    throw new ToolError('connection_required', `Ask the person to connect a ${providerLabel(provider)} key on their Scene Assembly account page. Agents cannot add keys.`);
  }
  const model = findModelDescriptor(provider, input.modelId, input.mediaType);
  if (!model) throw new ToolError('invalid_field', `${providerLabel(provider)} has no ${input.mediaType} model "${input.modelId}". Call list_models.`, { field: 'modelId' });
  const mode = model.modes.find(candidate => candidate.mode === input.inputMode);
  if (!mode) throw new ToolError('invalid_field', `${model.label} does not take ${input.inputMode} input.`, { field: 'inputMode', allowed: model.modes.map(candidate => candidate.mode) });
  const values = checkValues(mode, input.values ?? {});
  if (!values.ok) throw new ToolError('invalid_field', values.message, { field: values.field, ...(values.allowed !== undefined ? { allowed: values.allowed } : {}) });
  const count = input.references?.length ?? 0;
  const referenceProblem = checkReferences(mode, count, Boolean(input.sourceVideo));
  if (referenceProblem) throw new ToolError('invalid_field', referenceProblem, { field: mode.sourceVideo && !input.sourceVideo ? 'sourceVideo' : 'references', min: mode.references.min, max: mode.references.max });
  const request: CloudJobRequest = {
    provider, modelId: model.modelId, mediaType: model.mediaType, inputMode: mode.mode, prompt: input.prompt.trim(), values: values.values,
    referenceIds: Array.from({ length: count }, (_, index) => `pending-reference-${index}`),
    ...(input.sourceVideo ? { sourceVideoId: 'pending-source-video' } : {}),
  };
  validateRequest(env, request); // the Worker's authority, unchanged; throws AccountError
  return { request, model, mode };
}

const remaining = (outcome: ChargeOutcome) =>
  `${formatUsdTotal(outcome.status.remainingUsd)} of this agent's ${formatUsdTotal(outcome.status.limitUsd)} 24-hour limit is left.`;

export function describeEstimate(figure: SpendFigure, outcome: ChargeOutcome): string {
  const price = figure.costUsd === null ? `Price unknown: ${figure.note ?? 'no published price.'}` : `About ${formatUsd(figure.costUsd)} (${figure.confidence}).`;
  if (outcome.ok) return `${price} ${remaining(outcome)}`;
  if (outcome.code === 'cost_unknown') return `${price} This agent may not run models without a published price; the person can allow it on their Scene Assembly account page.`;
  return `${price} ${remaining(outcome)} ${outcome.roomAt === null ? 'This run costs more than the whole limit.' : `Room frees up at ${new Date(outcome.roomAt).toISOString()}.`}`;
}

export function budgetRefusal(outcome: Extract<ChargeOutcome, { ok: false }>, estimate: SpendFigure): ToolError {
  if (outcome.code === 'cost_unknown') {
    return new ToolError('cost_unknown', describeEstimate(estimate, outcome), { budget: outcome.status });
  }
  return new ToolError('budget_exceeded', describeEstimate(estimate, outcome), {
    estimateUsd: outcome.needUsd, limitUsd: outcome.status.limitUsd, usedUsd: outcome.status.usedUsd,
    remainingUsd: outcome.status.remainingUsd, roomAt: outcome.roomAt,
  });
}
