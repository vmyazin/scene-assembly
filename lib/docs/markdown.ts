import { Marked, type Tokens } from 'marked';

/** A heading's text as a URL fragment: "Tools" → "tools", "What `generate` costs" → "what-generate-costs". */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Headings get ids, so a link can point at a section (#tools, #errors). */
const docs = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }: Tokens.Heading) {
      const id = headingSlug(text);
      return `<h${depth}${id ? ` id="${id}"` : ''}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

/** Markdown to HTML for our own documentation files. Not for anything a person
 *  typed: nothing here sanitizes the output. */
export function renderDocsMarkdown(source: string): string {
  return docs.parse(source, { async: false });
}
