import { Marked, Renderer, type Tokens } from 'marked';

/** A heading's text as a URL fragment: "Tools" → "tools", "What `generate` costs" → "what-generate-costs". */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Markdown to HTML for our own documentation files. Not for anything a person
 * typed: nothing here sanitizes the output.
 *
 * Headings get ids so a link can point at a section (#tools, #errors). A heading
 * text used twice (a "References" section and a "References" group of errors)
 * gets `-2`, `-3` on its later ids, because two elements with one id make the
 * link reach only the first. The count lives in this call's own parser, so it
 * starts again for every document.
 *
 * Each table is wrapped in `.doc-table`, which scrolls sideways on its own: a
 * table of codes is wider than a phone, and the page itself must not scroll.
 */
export function renderDocsMarkdown(source: string): string {
  const seen = new Map<string, number>();
  const docs = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const slug = headingSlug(text);
        const count = (seen.get(slug) ?? 0) + 1;
        seen.set(slug, count);
        const id = slug && (count === 1 ? slug : `${slug}-${count}`);
        return `<h${depth}${id ? ` id="${id}"` : ''}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      table(token: Tokens.Table) {
        return `<div class="doc-table">${Renderer.prototype.table.call(this, token)}</div>\n`;
      },
    },
  });
  return docs.parse(source, { async: false });
}
