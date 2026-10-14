# Scene Assembly SEO Basics Audit

**Site:** https://sceneassembly.mzork.com/  
**Repo (read-only):** `/Users/vm/dev/nano-banana-ui` (machine `98e2decf-f8fd-4037-9888-b12bfc87095a`)  
**Audited:** 2026-09-09 (America/Sao_Paulo)  
**Scope:** basics only — no code changes

Ratings: **PASS** | **WEAK** | **MISSING**

---

## Executive snapshot

Social cards and brand metadata are in good shape. Crawl infrastructure and indexable body copy are not. The homepage is a `'use client'` studio shell: crawlers get title/description/OG tags but almost no meaningful HTML body text, no `<h1>`, no canonical, no robots/sitemap, and no marketing routes (`/pricing`, `/docs`, `/blog`, `/about` → 404). `site:sceneassembly.mzork.com` returned no indexed results at audit time.

For a BYOK multi-engine image/video studio, the highest-impact work is **making one public landing surface crawlable**, then **robots + sitemap**, then a few evergreen intent pages — not a blog first.

---

## 1. Public discovery assets

| Asset | Status | Evidence |
|---|---|---|
| `robots.txt` | **MISSING** | HTTP 404 |
| `sitemap.xml` | **MISSING** | HTTP 404 |
| `llms.txt` | **MISSING** | HTTP 404 |
| Web app manifest (`/manifest`, `/manifest.webmanifest`, `/manifest.json`, `/site.webmanifest`) | **MISSING** | All 404 |
| Favicon (`/favicon.ico`) | **PASS** | 200, `image/vnd.microsoft.icon` (~25 KB); also `/icon.svg` 200 |
| `og.png` | **PASS** | 200, PNG 2400×1260 (~442 KB); matches `metadata.openGraph.images` |
| Apple touch icon | **MISSING** | `/apple-touch-icon.png` 404 |

---

## 2. Homepage HTML signals

Fetched HTML size ~20 KB (Next.js RSC payload + metadata). Parsed crawl-visible body text ≈ **54 characters** (essentially the document title only).

| Check | Status | Detail |
|---|---|---|
| `<title>` | **PASS** | `Scene Assembly — Multi-engine image & video studio` (~50 chars) |
| Meta description | **PASS** (slightly short) | 121 chars: *“A multi-engine AI studio — generate and edit images with Gemini and FLUX, and create video with Veo, Kling, and Seedance.”* Ideal band ~150–160; content is on-message |
| Canonical | **MISSING** | No `<link rel="canonical">`; OG has `og:url` = `https://sceneassembly.mzork.com` (no trailing slash) |
| `<h1>` | **MISSING** | 0 `<h1>` in SSR HTML; UI hero uses `<motion.h2>` (“Create stunning images with AI power”) after client render |
| Crawlable body text | **WEAK / effectively MISSING** | Homepage is `'use client'` (`app/page.tsx`). SSR shell has no meaningful marketing copy for bots; Suspense fallback is `null` |
| JSON-LD / schema | **MISSING** | No `application/ld+json` |
| `lang` | **PASS** | `<html lang="en">` |
| Open Graph / Twitter | **PASS** | title, description, url, site_name, image (+w/h/alt), type=website; twitter `summary_large_image` |
| Icons in head | **PASS** | favicon.ico + icon.svg linked |

**Interpretation:** This is a client-heavy app homepage, not a marketing landing page. Google may index the title/description from metadata, but has little unique on-page content to rank or expand snippets from.

---

## 3. Codebase (read-only)

| Item | Status | Notes |
|---|---|---|
| Next `metadata` config | **PASS** | `app/layout.tsx` exports `metadata` from `lib/brand.ts` (`metadataBase`, title, description, openGraph, twitter) |
| Brand copy centralization | **PASS** | `lib/brand.ts` — `siteUrl`, `metaTitle`, `metaDescription`, `ogImageAlt`, hero blurb |
| `robots.ts` / `app/robots.ts` | **MISSING** | No robots route/file |
| Sitemap generation (`sitemap.ts` / static xml) | **MISSING** | None under `app/` or `public/` |
| `opengraph-image` route | **N/A / static PASS** | No Next `opengraph-image.*`; static `public/og.png` is used and live |
| Blog / docs marketing routes | **MISSING** | No `/blog`, `/docs`, `/pricing`, `/about` pages. In-repo `docs/` is engineering/specs, not public |
| App routes present | — | `/` (studio), `/timeline`, `/spend`, `/account`, `/sign-in`, `/sign-up`, plus API under `/api/*` |
| Auth noindex | **PASS** | `/account`, `/sign-in`, `/sign-up` set `robots: { index: false, follow: false }` |
| `/spend`, `/timeline` indexing | **WEAK** | Client pages; inherit default indexability with thin/empty SSR shells — candidates for `noindex` or richer metadata |
| Analytics | **PASS** | Plausible via `beforeInteractive` scripts in production (`layout.tsx`) — as noted |
| PWA manifest in repo | **MISSING** | Not in `app/` or `public/` |

---

## 4. Likely path indexing probe

| Path | HTTP | Note |
|---|---|---|
| `/` | **200** | Prerendered Next shell + client studio |
| `/pricing` | **404** | |
| `/docs` | **404** | |
| `/blog` | **404** | |
| `/about` | **404** | |
| `/sign-in` | **200** | noindex |
| `/sign-up` | **200** | noindex |
| `/account` | **200** | noindex |
| `/spend` | **200** | thin client page |
| `/timeline` | **200** | thin client page (`ssr: false` workspace) |

---

## 5. Index presence (WebSearch)

- `site:sceneassembly.mzork.com` → **no results**
- Broader queries for the live domain did not surface indexed product pages (unrelated “mz-scene-builder” RPG Maker tools dominate similar keywords)

**Signal:** Domain is effectively **not discoverable via Google organic** yet (or not indexed). Fix crawlability before expecting SEO compounding.

---

## Scorecard (basics)

| Basic | Rating |
|---|---|
| robots.txt | **MISSING** |
| sitemap.xml | **MISSING** |
| llms.txt | **MISSING** |
| Web manifest | **MISSING** |
| Favicon | **PASS** |
| og.png / social preview | **PASS** |
| Title | **PASS** |
| Meta description | **PASS** (trim/length OK; could enrich) |
| Canonical | **MISSING** |
| Single meaningful H1 | **MISSING** |
| Crawlable homepage body | **WEAK** |
| JSON-LD | **MISSING** |
| `lang` | **PASS** |
| Next metadata config | **PASS** |
| Marketing/content routes | **MISSING** |
| Auth noindex hygiene | **PASS** |
| Analytics (Plausible) | **PASS** |
| Google index presence | **MISSING** |

---

## Top recommended fixes (by impact)

Ranked for a **BYOK AI image/video studio** (creators comparing engines, bringing own keys, needing trust + clarity — not SaaS seat pricing SEO first).

1. **Ship a crawlable public landing (or SSR marketing section on `/`)** — **Highest**  
   Split “marketing homepage” from “studio app,” or SSR a real hero + value props + BYOK explainer + engine list as HTML (not only client). Use one clear `<h1>`, paragraphs bots can read, and CTAs into the studio. Without this, robots/sitemap alone won’t create rankings.

2. **Add `app/robots.ts` + `app/sitemap.ts`** — **High**  
   Allow `/`, future marketing pages; disallow or leave noindex on `/account`, `/sign-in`, `/sign-up`, `/api/*`; consider noindex on `/spend` and `/timeline` until they deserve indexing. Sitemap should list only public URLs. Submit in Search Console once DNS/property is ready.

3. **Add canonical + SoftwareApplication / WebApplication JSON-LD** — **High**  
   Canonical to `https://sceneassembly.mzork.com/` (pick slash policy and stick to it). Schema: name, description, url, applicationCategory, offers (BYOK / free UI), feature list (Gemini, FLUX, Veo, Kling, Seedance). Helps rich understanding even with few pages.

4. **2–4 evergreen intent pages (not a full blog yet)** — **High**  
   Examples: `/byok` or “how keys work,” `/engines` (comparison matrix), `/guides/image-to-video`, privacy/local-first storage. These match how creators search and reduce bounce from “what is this / is it safe with my keys?”

5. **`llms.txt` (optional but cheap)** — **Medium**  
   Short machine-readable product summary + key URLs for AI crawlers/assistants. Low effort; complements brand.ts copy.

6. **Tighten indexation of app shells** — **Medium**  
   Explicit `robots: noindex` on `/spend` and `/timeline` (and any future authenticated/tool UIs) so Google doesn’t waste crawl budget on empty client shells.

7. **Manifest + apple-touch-icon** — **Low–medium**  
   Helps PWA/homescreen polish more than classic SEO; still good hygiene for a studio product.

8. **Meta description polish** — **Low**  
   Stretch toward ~150 chars with BYOK / “your keys, your providers” differentiation if accurate.

9. **Search Console + sitemap ping** — **Process**  
   After (1)–(2), verify property and monitor coverage. Current zero `site:` results mean indexing isn’t happening yet.

---

## Blog recommendation

**Verdict: No — not yet. Add later (when), not now.**

**Rationale for this product specifically:**

- Scene Assembly is a **working studio / tool**, not a media brand. Organic demand clusters around **engine comparisons, BYOK trust, workflows** (image→video, reference modes), and “which UI wraps Gemini/FLUX/Veo/Kling” — not weekly thought leadership.
- There is **no crawlable homepage or sitemap** today; a blog on an unindexed client SPA wastes effort and creates thin URLs.
- Maintaining a blog costs consistency; for a small BYOK product, **stale blog** hurts more than no blog.
- **When to add:** after (a) SSR/marketing landing exists, (b) robots+sitemap+Search Console are live, (c) you have 3–5 evergreen pages that convert curiosity → trial, and (d) you can ship **sparse, high-signal posts** (changelog of engines, “Gemini vs FLUX for edit,” “Veo first-frame workflow”) tied to product updates — roughly monthly, not daily.

Prefer **docs-style evergreen pages + changelogs** over a traditional blog until traffic/retention justify editorial cadence.

---

## Quick reference: what’s already good

- Solid brand metadata in `lib/brand.ts` + root `layout.tsx`
- Working OG image at correct declared dimensions
- Favicon + SVG icon
- `lang="en"`
- Plausible in production
- Auth surfaces correctly marked `noindex`
- Clear product positioning in meta copy (multi-engine, named capabilities)

## Primary gap in one line

**Great social/metadata card; almost no indexable HTML product surface or crawl map — so Google has nothing durable to rank.**
