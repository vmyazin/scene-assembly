// lib/brand.ts
/**
 * Single source of truth for product branding.
 * Import from here instead of hardcoding the name or tagline in UI/metadata.
 */

export const brand = {
  name: 'Scene Assembly',
  /** Provider-neutral one-liner used in headers, hero copy, and metadata. */
  description: 'A multi-engine image and video studio.',
  /** Short eyebrow / subtitle next to the product name in the nav. */
  tagline: 'Multi-engine image & video studio',
  /**
   * Landing hero blurb. Kept to a single line: it shares a row with the engine
   * pills, and a wrapped blurb leaves them hanging off to one side.
   */
  heroBlurb: 'Generate and edit images and video across multiple engines.',
  /** Footer credit line product label (links to the repo). */
  shortName: 'Scene Assembly',
  githubUrl: 'https://github.com/vmyazin/scene-assembly',
  siteUrl: 'https://sceneassembly.mzork.com',
  /**
   * The production MCP server agents connect to: the account Worker's
   * `MCP_ORIGIN` plus `/mcp`. The setup guide at /docs/mcp prints this one
   * value; cloud/tests/mcp-docs.test.ts fails if it drifts from the Worker.
   */
  mcpUrl: 'https://mcp-sceneassembly.mzork.com/mcp',
  /** Document / social card title: "Scene Assembly — Multi-engine image & video studio" */
  metaTitle: 'Scene Assembly — Multi-engine image & video studio',
  /**
   * Search / social description. Leads on the choice being made — which engine
   * suits this job — then names the engines as capabilities, then the pricing
   * model, because "no monthly subscription" is the objection a searcher is
   * weighing before they click.
   *
   * Longer than the ~155 characters Google renders, so the tail ("connect your
   * keys and pay as you go") may truncate in a result. Everything load-bearing
   * sits in the first two sentences on purpose.
   */
  metaDescription:
    'Scene Assembly — pick the right engine for the job. Generate and edit images with Gemini; create video with Veo, Kling, or Seedance. No monthly subscription — connect your keys and pay as you go.',
  /** Open Graph image alt text. */
  ogImageAlt: 'Scene Assembly — a multi-engine image and video studio',
  maintainer: {
    name: 'Vasily Simon',
    url: 'https://github.com/vmyazin',
  },
} as const;

export type Brand = typeof brand;
