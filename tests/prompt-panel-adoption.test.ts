import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspaceFiles = [
  'components/GenerationInterface.tsx',
  'components/FalGenerationWorkspace.tsx',
  'components/KieGenerationWorkspace.tsx',
  'components/ProviderVideoWorkspace.tsx',
] as const;

describe('universal PromptPanel adoption', () => {
  for (const file of workspaceFiles) {
    it(`${file} renders the shared prompt wrapper exactly once`, () => {
      const source = readFileSync(`${process.cwd()}/${file}`, 'utf8');
      expect(source).toContain("import PromptPanel from '@/components/PromptPanel';");
      expect(source.match(/<PromptPanel(?:\s|>)/g)).toHaveLength(1);
      expect(source.match(/<\/PromptPanel>/g)).toHaveLength(1);
      if (file !== 'components/GenerationInterface.tsx') {
        // Props are allowed (a gated workspace passes `paused`); what the guard
        // fixes is that the prompt slot *is* the shared wrapper.
        // Kie names it once and places it in either layout (video's columns,
        // the image workspace's main column), so the slot may hold that name.
        expect(source).toMatch(/prompt=\{\s*<PromptPanel[\s>]|const promptPanel = \(\s*<PromptPanel[\s>]/);
      }
    });
  }
});
