# Sitemapper

Enter any domain and get a list of every page the site publishes, grouped by URL pattern. It's built for studying how programmatic-SEO sites structure their pages: `/predictions/arsenal-vs-chelsea` becomes `/predictions/*`, and `/league/premier-league/table` becomes `/league/*/table`.

## How it works

1. Reads `/robots.txt` for `Sitemap:` lines and the `Allow`/`Disallow` rules for `User-agent: *`.
2. Reads those sitemaps. If robots.txt lists none, it tries `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml` and `/wp-sitemap.xml`. Sitemap indexes are followed breadth-first, and gzipped `.xml.gz` sitemaps are supported.
3. If no sitemap has any pages, it crawls from the homepage instead. The crawl stays on the same host (www and the bare domain count as one), only reads HTML pages, and respects robots.txt.
4. Groups the URLs by pattern and shows how many pages each pattern has. You can filter the list, copy the URLs, or download them as CSV (`url,pattern`).
5. Optionally extracts page contents. **Extract contents** reads every page in the list (or only the ones matching the filter) and pulls out the title, meta description, H1, canonical, robots meta, headings, JSON-LD schema types, internal and external link counts, word count and main text (up to 32,000 characters, the most a spreadsheet cell holds). **Download CSV** then includes all of these as extra columns next to each URL. The page also summarises each pattern: the shared title, H1 and description templates (for example `{…} vs {…} Prediction | Site`), the word count range, schema types and the headings most pages share. You can stop at any time; running it again continues with the pages not read yet.

   When a site answers 429 (too many requests), every request pauses for as long as the site asks (its `Retry-After` header), or 10 seconds if it doesn't say. Pages that failed for temporary reasons (429, server errors, timeouts) are retried up to three more times at the end, one page at a time, after 5, 15 and 30 seconds. Sites that block automated requests (403) are reported as blocked in the CSV rather than worked around. The CSV starts with a UTF-8 byte order mark so Excel shows accents and dashes correctly.

Each request is stateless. There's no database and no login.

## JavaScript pages

Some sites send almost empty HTML and build their pages in the browser with JavaScript. Sitemapper notices this and loads those pages in a headless Chromium browser so the scripts can run:

- **Mapping.** When there's no sitemap and the homepage is a JavaScript shell (fewer than 80 words of text but loads scripts), or it refuses a plain request, the link crawl runs again in the browser. Browser crawls cover up to 40 pages, 3 at a time, within the same 50-second budget.
- **Extracting contents.** Every page is read as plain HTML first, which is fast. Pages that turn out to be JavaScript shells get a second read in the browser, 4 pages per request with 2 requests at a time. Each page shows whether it was read from the raw HTML or after running JavaScript, and the CSV has a `read_from` column.

In the browser, images, fonts, media and stylesheets are skipped to save time, and every request the page makes is checked, so a site's scripts can't reach private or local addresses. robots.txt is still respected.

This uses two extra dependencies, [`puppeteer-core`](https://pptr.dev) and [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) (a Chromium build made for serverless functions). On Vercel nothing needs configuring. Locally, Sitemapper uses your installed Google Chrome, or the path in `CHROME_PATH` if you set it. On Linux it falls back to the serverless Chromium build.

## Limits

| | |
| --- | --- |
| Sitemaps read | 60 |
| URLs collected | 50,000 |
| Pages crawled (when there's no sitemap) | 300, 4 at a time with a 300 ms pause between batches |
| Time per domain | 50 seconds in total, 10 seconds per request |
| Content extraction | 5,000 pages per run (run again to continue), 10 per request with 2 requests at a time, robots.txt respected |
| Browser rendering | 4 pages per request, 2 tabs at a time, 15 seconds per page |

When a limit is reached, the results say so. Sites behind bot protection (Cloudflare challenges and similar) often block the crawler. Sitemapper tells you when the homepage couldn't be loaded.

Requests identify themselves as `SitemapperBot/1.0 (site structure study tool)`. Local and private addresses (localhost, `*.local`, `*.internal`, private IP ranges, IPv6 literals) are rejected.

## Run locally

Requires Node.js 22.17 or newer. Rendering JavaScript pages locally needs Google Chrome installed (or `CHROME_PATH` pointing at a Chrome or Chromium binary).

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

To check the pattern grouping and title template rules:

```bash
npm run test:patterns
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Keep the default settings and deploy. No environment variables are needed.

The API routes run on the Node.js runtime with `maxDuration = 60`, which the Hobby plan allows. Set the project's Node.js version to 22.x (the default). The Chromium binary is bundled with the API routes through `outputFileTracingIncludes` in `next.config.ts`. The first JavaScript render after a cold start takes a few extra seconds while Chromium unpacks.

## Project layout

- `lib/crawl.ts`: input checks, robots.txt parsing, sitemap reading, fallback crawl, limits
- `lib/patterns.ts`: groups URLs into patterns
- `app/api/crawl/route.ts`: `POST { domain }`, returns `{ origin, source, sitemaps, truncated, notes, total, groups }`. To keep responses small, URLs on `origin` are sent as paths (`/predictions/x`) and the page turns them back into full URLs.
- `lib/extract.ts`: reads a page's title, meta tags, headings, schema types, links and main text
- `lib/render.ts`: starts headless Chromium and returns a page's HTML after its JavaScript has run
- `app/api/extract/route.ts`: `POST { urls, render }` (at most 10 URLs, or 4 with `render: true`), returns `{ pages }` in the same order
- `app/page.tsx`: the interface; `app/contents.tsx` shows extracted contents and `app/ui.tsx` holds shared icons and helpers

## Adding storage later

No database is needed for what Sitemapper does today. If you want saved history, or to track how a site's pages change over time (new patterns, pages added or removed), that's when adding Postgres with Prisma makes sense.
