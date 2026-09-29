import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');

/**
 * jsdom does no layout, so the table rules that decide what a phone shows are
 * pinned at the source. At 375 px a table whose code column cannot wrap used to
 * shrink its prose column to a few characters instead of scrolling.
 */
describe('docs table styles', () => {
  it('scrolls a wide table inside its wrapper', () => {
    expect(css).toMatch(/\.doc-prose \.doc-table\s*\{[^}]*overflow-x:\s*auto/s);
  });

  it('keeps codes in a cell on one line', () => {
    expect(css).toMatch(/\.doc-prose td code,\s*\.doc-prose th code\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('gives the explanation column room to read, so the table scrolls rather than crushing it', () => {
    expect(css).toMatch(/\.doc-prose th:last-child,\s*\.doc-prose td:last-child\s*\{[^}]*min-width:\s*14rem/s);
  });
});
