# Sitemapper

Enter any domain and get a list of every page the site publishes, grouped by URL pattern. It's built for studying how programmatic-SEO sites structure their pages: `/predictions/arsenal-vs-chelsea` becomes `/predictions/*`, and `/league/premier-league/table` becomes `/league/*/table`.

## How it works

1. Reads `/robots.txt` for `Sitemap:` lines and the `Allow`/`Disallow` rules for `User-agent: *`.
2. Reads those sitemaps. If robots.txt lists none, it tries `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml` and `/wp-sitemap.xml`. Sitemap indexes are followed breadth-first, and gzipped `.xml.gz` sitemaps are supported.
3. If no sitemap has any pages, it crawls from the homepage instead. The crawl stays on the same host (www and the bare domain count as one), only reads HTML pages, and respects robots.txt.
4. Groups the URLs by pattern and shows how many pages each pattern has. You can filter the list, copy the URLs, or download them as CSV (`url,pattern`).
5. Optionally extracts page contents. Open a pattern and choose **Extract contents** to read up to 100 of its pages (spread evenly across the pattern). For each page you get the title, meta description, H1, canonical, robots meta, headings outline, JSON-LD schema types, internal and external link counts, word count, and the main text (up to 20,000 characters). Across the pattern it shows the shared title, H1 and description templates (for example `{…} vs {…} Prediction | Site`), the word count range, the schema types and the headings most pages share. Download it all as `<host>-<pattern>-contents.csv`.

Each request is stateless. There's no database and no login.

## Limits

| | |
| --- | --- |
| Sitemaps read | 60 |
| URLs collected | 50,000 |
| Pages crawled (when there's no sitemap) | 300, 4 at a time with a 300 ms pause between batches |
| Time per domain | 50 seconds in total, 10 seconds per request |
| Content extraction | 100 pages per pattern, sent 10 per request, 4 fetched at a time, robots.txt respected |

When a limit is reached, the results say so. Sites behind bot protection (Cloudflare challenges and similar) often block the crawler. Sitemapper tells you when the homepage couldn't be loaded.

Requests identify themselves as `SitemapperBot/1.0 (site structure study tool)`. Local and private addresses (localhost, `*.local`, `*.internal`, private IP ranges, IPv6 literals) are rejected.

## Run locally

Requires Node.js 18.18 or newer.

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

The API route runs on the Node.js runtime with `maxDuration = 60`, which the Hobby plan allows.

## Project layout

- `lib/crawl.ts`: input checks, robots.txt parsing, sitemap reading, fallback crawl, limits
- `lib/patterns.ts`: groups URLs into patterns
- `app/api/crawl/route.ts`: `POST { domain }`, returns `{ origin, source, sitemaps, truncated, notes, total, groups }`. To keep responses small, URLs on `origin` are sent as paths (`/predictions/x`) and the page turns them back into full URLs.
- `lib/extract.ts`: reads a page's title, meta tags, headings, schema types, links and main text
- `app/api/extract/route.ts`: `POST { urls }` (at most 10), returns `{ pages }` in the same order
- `app/page.tsx`: the interface; `app/contents.tsx` shows extracted contents and `app/ui.tsx` holds shared icons and helpers

## Adding storage later

No database is needed for what Sitemapper does today. If you want saved history, or to track how a site's pages change over time (new patterns, pages added or removed), that's when adding Postgres with Prisma makes sense.
