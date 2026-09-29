import { describe, expect, it } from 'vitest';
import { renderDocsMarkdown } from '@/lib/docs/markdown';

describe('renderDocsMarkdown', () => {
  it('gives a repeated heading a numbered id, so every id on the page is unique', () => {
    const html = renderDocsMarkdown('## References\n\n### Idempotency\n\n## Errors\n\n### Idempotency\n\n### References\n\n### References\n');
    expect([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1])).toEqual(['references', 'idempotency', 'errors', 'idempotency-2', 'references-2', 'references-3']);
  });

  it('starts counting again for each document', () => {
    expect(renderDocsMarkdown('## Tools\n')).toContain('id="tools"');
    expect(renderDocsMarkdown('## Tools\n')).toContain('id="tools"');
  });

  it('wraps each table in its own scrolling container', () => {
    const html = renderDocsMarkdown('| Code | Meaning |\n| --- | --- |\n| `invalid_field` | Wrong |\n');
    expect(html).toMatch(/^<div class="doc-table"><table>[\s\S]*<\/table>\s*<\/div>/);
    expect(html).toContain('<code>invalid_field</code>');
  });
});
