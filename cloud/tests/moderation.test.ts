// cloud/tests/moderation.test.ts
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adapter } from './database';
import { LOCAL_SCHEMA } from '../src/schema';
import { validateRequest } from '../src/providers';
import { enforceRelaxedConsent, recordRelaxedConsent } from '../src/relaxed-consent';
import type { Env } from '../src/security';
import type { CloudJobRequest } from '../../lib/account/contracts';

let db: DatabaseSync;
let env: Env;

const base = (patch: Partial<CloudJobRequest>): CloudJobRequest => ({
  provider: 'fal',
  modelId: 'nano-banana-2',
  mediaType: 'image',
  inputMode: 'text',
  prompt: 'a red kite',
  values: {},
  referenceIds: [],
  ...patch,
});

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(LOCAL_SCHEMA);
  db.exec(
    "INSERT INTO account_users (id,google_subject,email,name,created_at) VALUES ('owner','google','test@example.test','Test',1)"
  );
  env = {
    DB: adapter(db),
    APP_ORIGIN: 'http://localhost:3097',
    CLOUD_GENERATION_PROVIDERS: 'fal,kie,atlas,comet,gemini,runware',
  };
});

afterEach(() => db.close());

describe('cloud moderation validators', () => {
  it('accepts moderation only on routes that can honor it', () => {
    expect(validateRequest(env, base({ values: { moderation: 'relaxed' } })).values.moderation).toBe('relaxed');
    expect(
      validateRequest(env, base({
        provider: 'atlas',
        modelId: 'black-forest-labs/flux-schnell',
        values: { moderation: 'standard' },
      })).values.moderation
    ).toBe('standard');
    expect(
      validateRequest(env, base({
        provider: 'comet',
        modelId: 'gpt-image-2',
        values: { moderation: 'relaxed' },
      })).values.moderation
    ).toBe('relaxed');
    expect(
      validateRequest(env, base({
        provider: 'kie',
        modelId: 'flux-2-pro',
        values: { moderation: 'relaxed' },
      })).values.moderation
    ).toBe('relaxed');

    expect(() =>
      validateRequest(env, base({ provider: 'fal', modelId: 'seedance-2', mediaType: 'video', values: { moderation: 'relaxed' } }))
    ).toThrow(/not a setting/);
    expect(() =>
      validateRequest(env, base({ provider: 'comet', modelId: 'qwen-image', values: { moderation: 'relaxed' } }))
    ).toThrow(/not a setting/);
    expect(() =>
      validateRequest(env, base({
        provider: 'gemini',
        modelId: 'gemini-3-pro-image-preview',
        values: { moderation: 'relaxed' },
      }))
    ).toThrow();
    expect(() =>
      validateRequest(env, base({ provider: 'runware', modelId: 'runware:400@1', values: { moderation: 'relaxed' } }))
    ).toThrow(/not a setting/);
  });

  it('rejects the provider keys and the locked knobs', () => {
    expect(() => validateRequest(env, base({ values: { safety_tolerance: '6' } }))).toThrow(/safety_tolerance/);
    expect(() =>
      validateRequest(env, base({
        provider: 'atlas',
        modelId: 'black-forest-labs/flux-schnell',
        values: { enable_safety_checker: false },
      }))
    ).toThrow(/enable_safety_checker/);
    expect(() =>
      validateRequest(env, base({
        provider: 'atlas',
        modelId: 'black-forest-labs/flux-schnell',
        values: { real_person: true },
      }))
    ).toThrow(/real_person/);
    expect(() =>
      validateRequest(env, base({
        provider: 'kie',
        modelId: 'veo-3-1',
        mediaType: 'video',
        values: { enableFallback: true },
      }))
    ).toThrow(/Fallback cannot be enabled/);
    expect(() =>
      validateRequest(env, base({
        provider: 'kie',
        modelId: 'grok-imagine',
        mediaType: 'video',
        values: { mode: 'spicy' },
      }))
    ).toThrow(/not available/);
    expect(() =>
      validateRequest(env, base({
        provider: 'kie',
        modelId: 'veo-3-1',
        mediaType: 'video',
        values: { enable_fallback: true },
      }))
    ).toThrow(/enable_fallback/);

    expect(() =>
      validateRequest(env, base({
        provider: 'kie',
        modelId: 'veo-3-1',
        mediaType: 'video',
        values: { enableFallback: false },
      }))
    ).not.toThrow();
    expect(() =>
      validateRequest(env, base({ provider: 'kie', modelId: 'flux-2-pro', values: { nsfw_checker: true } }))
    ).not.toThrow();
  });

  it('forces Standard when a reference is attached or the prompt names a minor', () => {
    const referenced = validateRequest(env, base({
      values: { moderation: 'relaxed' },
      referenceIds: ['ref-1'],
    }));
    expect(referenced.values.moderation).toBe('standard');

    const minor = validateRequest(env, base({
      prompt: 'a child playing in a park',
      values: { moderation: 'relaxed' },
    }));
    expect(minor.values.moderation).toBe('standard');

    expect(() =>
      validateRequest(env, base({ prompt: 'a nude child', values: { moderation: 'relaxed' } }))
    ).toThrow(/minors in a suggestive context/);
  });

  it('downgrades a relaxed job until the account has confirmed the current policy', async () => {
    const request = validateRequest(env, base({ values: { moderation: 'relaxed' } }));
    expect((await enforceRelaxedConsent(env, 'owner', request)).values.moderation).toBe('standard');
    await recordRelaxedConsent(env, 'owner', 1);
    expect((await enforceRelaxedConsent(env, 'owner', request)).values.moderation).toBe('relaxed');
  });
});
