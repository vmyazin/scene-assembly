import type { Metadata } from 'next';
import AccountPageShell from '@/components/account/AccountPageShell';
import { renderDocsMarkdown } from '@/lib/docs/markdown';
import { readMcpGuide } from '@/lib/docs/mcp-guide';

// Read and rendered at build time: nothing here depends on the request.
export const dynamic = 'force-static';

/**
 * The guide opens with its `# title` and a one-paragraph lead. The page shell
 * already renders a title and a description, so those two come off the top
 * here rather than appearing twice; /docs/mcp.md keeps them.
 */
function splitGuide(markdown: string) {
  const match = /^# (.+)\n\n((?:.+\n)+)\n/.exec(markdown);
  if (!match) throw new Error('The MCP guide must open with a # title and a one-paragraph lead.');
  return { title: match[1].trim(), lead: match[2].replace(/\s+/g, ' ').trim(), body: markdown.slice(match[0].length) };
}

const guide = splitGuide(readMcpGuide());

export const metadata: Metadata = {
  title: 'Connect an agent · Scene Assembly',
  description: guide.lead,
  alternates: { canonical: '/docs/mcp', types: { 'text/markdown': '/docs/mcp.md' } },
};

export default function McpDocsPage() {
  return (
    <AccountPageShell eyebrow="SETUP GUIDE" title={guide.title} description={guide.lead}>
      {/* Our own checked-in Markdown, never user input, so it is safe to inject. */}
      <article className="doc-prose mt-10" dangerouslySetInnerHTML={{ __html: renderDocsMarkdown(guide.body) }} />
    </AccountPageShell>
  );
}
