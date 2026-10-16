import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every workspace that can start a generation retries a transient failure the
 * same way — all models, all providers. A workspace that grows its own retry,
 * or none at all, is the drift this guard catches.
 */
const read = (file: string) => readFileSync(`${process.cwd()}/${file}`, 'utf8');

/** Workspaces whose button and error live in the shared `GenerateActions`. */
const sharedActionWorkspaces = [
  'components/GenerationInterface.tsx',
  'components/FalGenerationWorkspace.tsx',
  'components/KieGenerationWorkspace.tsx',
  'components/ProviderVideoWorkspace.tsx',
] as const;

function expectSharedRetryGate(source: string) {
  expect(source).toMatch(/from '@\/lib\/providers\/auto-retry'/);
  expect(source.match(/useAutoRetry\(\)/g)).toHaveLength(1);
  // Scheduled only behind the retryable-failure gate, never on every failure.
  expect(source).toMatch(/isRetryableFailure\([^)]*\)\s*(&&|\))/);
}

describe('shared automatic retry adoption', () => {
  for (const file of sharedActionWorkspaces) {
    it(`${file} retries through the shared countdown and GenerateActions`, () => {
      const source = read(file);
      expectSharedRetryGate(source);
      // A run that worked hands back the budget; the press itself is GenerateActions'.
      expect(source.match(/autoRetry\.reset\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(source).toMatch(/<GenerateActions[\s\S]*?autoRetry=\{autoRetry\}/);
    });
  }

  it('GenerateActions resets the budget on a press and keeps the countdown cancellable', () => {
    const source = read('components/GenerateActions.tsx');
    expect(source).toMatch(/onClick=\{\(\) => \{[\s\S]*?autoRetry\.reset\(\);[\s\S]*?onSubmit\(\);/);
    expect(source).toMatch(/onCancelRetry=\{autoRetry\.cancel\}/);
  });
});
