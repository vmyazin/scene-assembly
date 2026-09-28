import * as z from 'zod';
import { describeModels, type AgentProvider } from '../../../../lib/account/model-schema';
import { estimateCloudJob } from '../../../../lib/spend/estimate';
import { CLOUD_PROVIDERS, enabledProviders } from '../../providers';
import { previewCharge } from '../budget';
import { defineTool } from '../tool';
import { connectedProviders, describeEstimate, prepareRequest, requestShape } from './request';

export const listModels = defineTool({
  name: 'list_models',
  title: 'List models',
  description: 'Models this account can run right now: providers whose key is connected on the account and that are enabled for background generation. Without filters it returns a compact list; pass provider and modelId to get each input mode\'s settings (fields with options, bounds and defaults), how many reference images it takes, and whether it edits a source video.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({
    provider: z.enum(CLOUD_PROVIDERS).optional(),
    modelId: z.string().max(256).optional(),
    mediaType: z.enum(['image', 'video']).optional(),
    inputMode: z.enum(['text', 'image', 'frames', 'reference', 'edit']).optional(),
  }),
  async run(ctx, args) {
    const connected = await connectedProviders(ctx.env, ctx.agent.user_id);
    const providers = enabledProviders(ctx.env).filter(provider => connected.includes(provider) && (!args.provider || provider === args.provider)) as AgentProvider[];
    const detailed = Boolean(args.provider || args.modelId);
    const models = describeModels(providers)
      .filter(model => (!args.modelId || model.modelId === args.modelId) && (!args.mediaType || model.mediaType === args.mediaType))
      .map(model => ({ ...model, modes: model.modes.filter(mode => !args.inputMode || mode.mode === args.inputMode) }))
      .filter(model => model.modes.length > 0)
      .map(model => detailed ? model : {
        provider: model.provider, modelId: model.modelId, label: model.label, mediaType: model.mediaType,
        ...(model.price ? { price: model.price } : {}), inputModes: model.modes.map(mode => mode.mode),
      });
    const text = !providers.length && !args.provider
      ? 'No provider is available to this agent. Ask the person to connect a provider key on their Scene Assembly account page.'
      : models.length ? `${models.length} model${models.length === 1 ? '' : 's'} available.${detailed ? '' : ' Pass provider and modelId to see a model\'s settings.'}`
        : 'No model matches those filters.';
    return { structured: { models, connectedProviders: providers }, text };
  },
});

export const estimateCost = defineTool({
  name: 'estimate_cost',
  title: 'Estimate cost',
  description: 'Price a generate request before running it, and check it against this agent\'s 24-hour spend limit. Takes the same fields as generate. Settings left out are filled with the model\'s defaults exactly as generate will fill them, and the response echoes them in values.',
  kind: 'read',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object(requestShape),
  async run(ctx, args) {
    const { request } = await prepareRequest(ctx, args);
    const figure = estimateCloudJob(request);
    const outcome = await previewCharge(ctx.env, ctx.agent, figure, ctx.now());
    return {
      structured: {
        costUsd: figure.costUsd, confidence: figure.confidence, ...(figure.note ? { note: figure.note } : {}),
        values: request.values, budget: outcome.status, allowed: outcome.ok,
        ...(outcome.ok ? {} : { refusal: outcome.code, ...(outcome.code === 'budget_exceeded' ? { roomAt: outcome.roomAt } : {}) }),
      },
      text: describeEstimate(figure, outcome),
    };
  },
});
