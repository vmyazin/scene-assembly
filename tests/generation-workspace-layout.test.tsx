import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import GenerationWorkspaceLayout from '@/components/GenerationWorkspaceLayout';

it('keeps setup, prompt, submission feedback, and results in reading order', () => {
  render(
    <GenerationWorkspaceLayout
      setup={<button>Configure model</button>}
      prompt={<textarea aria-label="Prompt" />}
      actions={<><button>Generate</button><p role="alert">Retry in 10 seconds</p></>}
      results={<h2>Results</h2>}
    />,
  );
  const sequence = [
    screen.getByRole('button', { name: 'Configure model' }),
    screen.getByRole('textbox', { name: 'Prompt' }),
    screen.getByRole('button', { name: 'Generate' }),
    screen.getByRole('alert'),
    screen.getByRole('heading', { name: 'Results' }),
  ];
  sequence.slice(1).forEach((element, index) => {
    expect(sequence[index].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * The two panels above the results hold at the top of the viewport while the
 * results scroll past them, and the three conditions that allow it are each
 * silently breakable: a grid item stretched to its row has no room to move, a
 * stuck panel taller than the screen strands its own bottom controls, and any
 * ancestor with a `hidden` overflow axis turns into a scroll container that
 * cancels `sticky` outright — which is how the header spent months marked
 * sticky without ever sticking. jsdom computes no layout, so this is a check on
 * the declarations rather than on the scroll.
 */
it('lets the setup and prompt panels stick while results scroll past', () => {
  const { container } = render(
    <GenerationWorkspaceLayout
      setup={<button>Configure model</button>}
      prompt={<textarea aria-label="Prompt" />}
      actions={<button>Generate</button>}
      results={<h2>Results</h2>}
    />,
  );
  const grid = container.firstElementChild as HTMLElement;
  expect(grid.className).toContain('lg:items-start');

  const setupPanel = grid.children[0] as HTMLElement;
  const promptPanel = grid.children[1].firstElementChild as HTMLElement;
  for (const panel of [setupPanel, promptPanel]) {
    expect(panel.className).toContain('lg:sticky');
    expect(panel.className).toMatch(/lg:max-h-\[calc\(100dvh/);
    expect(panel.className).toContain('lg:overflow-y-auto');
  }
  // Results pass under this pane, which is why it has a stacking context.
  // Dialogs must portal to body (`DialogPortal`) rather than competing here.
  expect(promptPanel.className).toContain('lg:z-20');
  // Results stay in the scrolling flow, outside the stuck block.
  expect(promptPanel.textContent).not.toContain('Results');
});

it('keeps every wrapper above the workspace out of `overflow-x: hidden`', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
  expect(read('app/globals.css')).not.toMatch(/overflow-x:\s*hidden/);
  expect(read('app/page.tsx')).not.toContain('overflow-x-hidden');
});
