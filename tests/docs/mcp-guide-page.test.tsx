import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import McpDocsPage, { dynamic, metadata } from '@/app/docs/mcp/page';

describe('the setup guide page', () => {
  it('renders the guide with a title, linkable sections and the MCP URL', () => {
    const { container } = render(<McpDocsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connect an agent');
    expect(container.querySelector('h2#tools')).toHaveTextContent('Tools');
    expect(container.querySelector('h2#errors')).toHaveTextContent('Errors');
    expect(container.textContent).toContain('https://mcp-sceneassembly.smoxu.com/mcp');
    // Markdown that reached the page unrendered would show up as literal syntax.
    expect(container.textContent).not.toMatch(/^#+ /m);
    expect(screen.getByRole('link', { name: 'Back to studio' })).toHaveAttribute('href', '/');
  });

  it('gives every element a unique id, and every in-page link a target', () => {
    const { container } = render(<McpDocsPage />);
    const ids = [...container.querySelectorAll('[id]')].map(element => element.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    for (const link of container.querySelectorAll('a[href^="#"]')) {
      expect(ids).toContain(link.getAttribute('href')!.slice(1));
    }
  });

  it('puts every table in a scrolling wrapper, so a narrow screen scrolls the table and not the page', () => {
    const { container } = render(<McpDocsPage />);
    const tables = [...container.querySelectorAll('.doc-prose table')];
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(table.parentElement).toHaveClass('doc-table');
  });

  it('is indexable, static, and points agents at the Markdown', () => {
    expect(dynamic).toBe('force-static');
    expect(metadata.title).toBe('Connect an agent · Scene Assembly');
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates).toEqual({ canonical: '/docs/mcp', types: { 'text/markdown': '/docs/mcp.md' } });
  });
});
