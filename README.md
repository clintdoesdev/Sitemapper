# Sitemapper

Enter any domain and get a list of every page the site publishes, grouped by URL pattern, then open sample pages from each pattern to see how the site is built: SEO, structured data, page templates, the programmatic content engine, internal linking, tech stack, monetisation and trust signals, and performance proxies. It's built for studying programmatic-SEO sites (football predictions sites, for example) but works on any site: `/predictions/arsenal-vs-chelsea` becomes `/predictions/*`, and `/league/premier-league/table` becomes `/league/*/table`.

## How it works

1. Reads `/robots.txt` for `Sitemap:` lines and the `Allow`/`Disallow` rules for `User-agent: *`.
2. Reads those sitemaps. If robots.txt lists none, it tries `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml` and `/wp-sitemap.xml`. Sitemap indexes are followed breadth-first, and gzipped `.xml.gz` sitemaps are supported.
3. If no sitemap has any pages, it crawls from the homepage instead. The crawl stays on the same host (www and the bare domain count as one), only reads HTML pages, and respects robots.txt.
4. Groups the URLs by pattern and shows how many pages each pattern has. You can filter the list, copy the URLs, or download them as a spreadsheet (**Download page list**, CSV with `url,pattern`).
5. Optionally reads every page. **Read every page** reads every page in the list (or only the ones matching the filter) and pulls out the title, meta description, H1, canonical, robots meta, headings, JSON-LD schema types, internal and external link counts, word count and main text (up to 32,000 characters, the most a spreadsheet cell holds). **Download page list** then includes all of these as extra columns next to each URL. The page also summarises each pattern: the shared title, H1 and description templates (for example `{…} vs {…} Prediction | Site`), the word count range, schema types and the headings most pages share. You can stop at any time; running it again continues with the pages not read yet. With storage connected (see [Reading in the background](#reading-in-the-background)) it runs on the server, so you can close the page or switch off your phone and come back later with the job link.

   When a site answers 429 (too many requests), every request pauses for as long as the site asks (its `Retry-After` header), or 10 seconds if it doesn't say. Pages that failed for temporary reasons (429, server errors, timeouts) are retried up to three more times at the end, one page at a time, after 5, 15 and 30 seconds. Sites that block automated requests (403) are reported as blocked in the CSV rather than worked around. The CSV starts with a UTF-8 byte order mark so Excel shows accents and dashes correctly.

Each request is stateless. There's no database and no login. Results live in the page and leave through the exports.

## Analysing how the site is built

After mapping, choose **Pages per pattern** (1, 2 or 3; default 2) and press **Study sample pages**. Sitemapper analyses the largest 20 patterns and the homepage; each expanded pattern also has **Analyse this pattern**. Sample pages come from the start, middle and end of each group, because sitemaps are often ordered by date. **Stop** cancels and keeps what has finished.

1. **Site checks** (once per mapped site, before the pages): robots.txt (groups, disallow rules, crawl-delay, declared sitemaps, and whether GPTBot, ClaudeBot, CCBot, Google-Extended, PerplexityBot and Bytespider are blocked), ads.txt and app-ads.txt (DIRECT/RESELLER counts, ad systems, OWNERDOMAIN, MANAGERDOMAIN), llms.txt, security.txt, humans.txt, the web manifest, http to https, www versus the bare domain, trailing slashes, how a made-up URL is answered (real 404, soft 404 or redirect), the homepage's caching and security headers, and a full analysis of the homepage.
2. **Page analysis** for each sample:
   - Head and indexing: title, description, robots meta, googlebot, X-Robots-Tag, canonical (missing, self, other, relative), lang, hreflang, Open Graph and Twitter tags, favicons, manifest, resource hints, AMP, feeds, prev/next.
   - Structured data: every JSON-LD block with `@graph` flattened, key values for SportsEvent, Event, Article, NewsArticle, BreadcrumbList, FAQPage, Organization, WebSite, Product, Review and AggregateRating; invalid JSON is reported, not fatal; microdata and RDFa types; FAQ questions that aren't visible on the page.
   - Structure: main content (words, paragraphs, text-to-HTML ratio), the heading outline, a block map of landmarks and the sections of the main content, tables, images, iframes, breadcrumbs, visible dates and FAQ blocks.
   - Links: internal links by target pattern with anchor texts, internal URLs that match no pattern, query parameters, external domains with rel values, affiliate redirect paths, tracking parameters and networks, messaging and social links, app links.
   - Tech: framework and CMS fingerprints (Next.js pages or app router, Nuxt, SvelteKit, Astro, Gatsby, Remix, Angular, SPAs, WordPress with Yoast, Rank Math, Elementor and WooCommerce, Shopify, Webflow, Wix, Squarespace, Ghost, Drupal and more), hosting and CDN, rendering, third parties by category (from `lib/extract/hosts.ts`), tag IDs, and embedded data clues.
   - Monetisation, conversion and trust: ads above and below the first H2, login, pricing and VIP links, newsletters, push opt-in, locked content, prices, 18+ and responsible-gambling notices, help organisations, licences, policies and author bylines.
   - Niche: sports predictions/betting, e-commerce, news/blog, SaaS or other, with the signals that decided it (dictionaries in `lib/extract/niche.ts`). Betting pages also get fixtures, kickoff times, markets, odds, bookmakers, tip labels, confidence, accumulator terms, booking codes and results.
   - Performance proxies: HTML size, response time, scripts, stylesheets, fonts and images, with links to PageSpeed Insights, the Rich Results Test and the Schema Markup Validator. These are proxies from the HTML, not Core Web Vitals.
3. **Per pattern**: title, description, H1 and og:title templates (`{x} vs {x} Prediction, Tips & Odds – {date}`), canonical and og:image behaviour, schema on every sample versus some, template and conditional blocks, the content engine (templated sentences, boilerplate and how unique each page's text is), averages and outgoing links.
4. **Site-wide**: a link map between patterns, patterns no sampled page links to, internal URLs that aren't in the sitemap, the stack, third parties and niche split.
5. **Issues** with a severity, a one-line explanation, affected patterns and example URLs. Pages behind bot protection are listed separately and don't count as site issues.

### Using the page

After you map a site, the page shows three things in order:

1. **Download**: every file in one place, each with a sentence saying what's inside.
   - **Download page list**: a spreadsheet (CSV) of every page and its URL pattern, or only the pages matching your filter. After **Read every page** it also holds each page's title, headings and text. **Copy the page links instead** copies the URLs.
   - **Download report**: a readable Markdown summary of how the site is built (`<host>-sitemapper-report.md`), facts only, in the same section order for every site so reports compare cleanly. Every studied URL is a full link. **Copy the report instead** copies it.
   - **Download studied pages**: one row per studied page (`<host>-pages-analysed.csv`).
   - **Download everything**: the full result as JSON (`<host>-sitemapper.json`), including every mapped URL.
   The last three unlock once you've studied sample pages.
2. **Want more detail?**: two optional ways to dig deeper. **Study sample pages** (recommended) opens 1 to 3 pages from each of the 20 biggest patterns plus the homepage. **Read every page** adds each page's title, headings and text to the page list.
3. **Results**, in tabs: **Pages** (the patterns, each with URLs, Template, Content, Links, Ads and trust, and Issues views), **Problems**, **Site** (site files, host behaviour, stack, and method and limits) and **Links** (the link map).

The "Send requests as a regular browser" setting is under **Advanced options** below the domain field.

### Politeness and safety

- Site checks and page analysis always identify as `SitemapperBot/1.0 (site structure study tool)`.
- Never more than 4 requests in flight to the site during an analysis (two analysis calls at a time, two pages each), with a 300 ms pause between batches. Studying sample pages and Read every page can't run at the same time.
- robots.txt is read first; disallowed URLs are skipped and listed under **Method and limits**.
- Outbound and affiliate links (`/go/`, `/out/`, `/visit/`, `/recommends/`, tracking redirects) are recorded, never requested. Redirects that leave the site are recorded, not followed.
- No forms are submitted, nothing logs in, and bot protection is never worked around. A page behind a challenge (a 403 or 503 with `cf-mitigated`, a "Just a moment..." page or a challenge-platform marker) shows "Blocked by bot protection. Open view-source:URL in a browser to study it manually." inside its pattern, and the rest of the analysis continues.
- Every URL goes through an SSRF guard: local and private hostnames are rejected, and names are resolved so that any private, loopback, link-local, CGNAT or IPv6 local address is refused, on every redirect hop. `/api/site` and `/api/analyse` refuse any URL that isn't on the mapped site, and every API route rejects requests from other origins.

## JavaScript pages

Some sites send almost empty HTML and build their pages in the browser with JavaScript. Sitemapper notices this and loads those pages in a headless Chromium browser so the scripts can run:

- **Mapping.** When there's no sitemap and the homepage is a JavaScript shell (fewer than 80 words of text but loads scripts), or it refuses a plain request, the link crawl runs again in the browser. Browser crawls cover up to 40 pages, 3 at a time, within the same 50-second budget.
- **Read every page.** Every page is read as plain HTML first, which is fast. Pages that turn out to be JavaScript shells get a second read in the browser, 4 pages per request with 2 requests at a time. Each page shows whether it was read from the raw HTML or after running JavaScript, and the CSV has a `read_from` column.

In the browser, images, fonts, media and stylesheets are skipped to save time, and every request the page makes is checked, so a site's scripts can't reach private or local addresses. robots.txt is still respected.

This uses two extra dependencies, [`puppeteer-core`](https://pptr.dev) and [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) (a Chromium build made for serverless functions). On Vercel nothing needs configuring. Locally, Sitemapper uses your installed Google Chrome, or the path in `CHROME_PATH` if you set it. On Linux it falls back to the serverless Chromium build.

## Reading in the background

Without storage, **Read every page** runs from the open page: close the tab or let your phone sleep and it stops. Connect a free Upstash Redis database and it runs on the server instead:

1. In your Vercel project, open the **Storage** tab, choose **Upstash for Redis** (from the Marketplace), create a free database and connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the Upstash console work too.)
2. Redeploy.

Press **Read every page** and the address bar gets a job link (`/?job=…`), also shown under the progress bar with a **Copy link** button. Close the page whenever you like. Open the link later, on any device, to see how far it got, and **Download page list** gives the pages with everything read so far. Jobs and their results are kept for 7 days.

How it works: the server reads in slices of about 50 seconds (Vercel's Hobby plan stops a function after 60). Each slice saves its progress to Redis and then calls the app's own `/api/jobs/<id>/run` to start the next one. If a slice is ever lost (a crash or a failed hand-over), opening the job link restarts it from the last saved step. The same politeness rules apply as in the browser: robots.txt is read once per job and respected, affiliate paths are never requested, a 429 pauses the job for as long as the site asks (up to a minute), temporary failures get three slower retry rounds, and JavaScript pages get a second read in a browser. At most 3 jobs run at once on one deployment.

On preview deployments behind Vercel Deployment Protection, the self-call that starts each slice is refused unless you add a **Protection Bypass for Automation** secret (Vercel adds it as `VERCEL_AUTOMATION_BYPASS_SECRET`, which Sitemapper sends along). The production domain isn't protected by default, so it works there without this.

Running locally with `npm run dev`, jobs are kept in memory without any setup and are lost when the server restarts.

## Limits

| | |
| --- | --- |
| Sitemaps read | 60 |
| URLs collected | 50,000 |
| Pages crawled (when there's no sitemap) | 300, 4 at a time with a 300 ms pause between batches |
| Time per domain | 50 seconds in total, 10 seconds per request |
| Read every page | 5,000 pages per run (run again to continue), 20 per request, 3 requests at a time, each reading 6 pages at once as soon as a slot frees up; robots.txt read once per run and respected |
| Reading in the background | 5,000 pages per job, 60 pages per step with 18 at once, slices of about 50 seconds, 3 jobs at a time, kept 7 days |
| Browser rendering | 4 pages per request, 2 tabs at a time, 15 seconds per page |
| Analysis | Up to 3 pages per pattern, the largest 20 patterns plus the homepage |
| Page size | Pages stop being read at 3 MB and are marked truncated |
| Requests to the site during analysis | At most 4 in flight, 300 ms between batches |
| API responses | Kept well under Vercel's 4.5 MB limit; large raw blocks are cut and the result says so |

When a limit is reached, the results say so. Sites behind bot protection (Cloudflare challenges and similar) often block the crawler. Sitemapper tells you when the homepage couldn't be loaded.

Requests identify themselves as `SitemapperBot/1.0 (site structure study tool)` by default. Site checks and page analysis always do.

Some sites refuse anything that looks like a tool. For those, tick **Send requests as a regular browser** under the domain field. Mapping and extracting (not the analysis) then send a standard desktop Chrome user agent and browser headers, and pages that still come back blocked (401/403) get a second try in the headless browser. robots.txt and the rate-limit pauses still apply. It won't get past challenge pages such as Cloudflare's "checking your browser" screen or CAPTCHAs. Local and private addresses (localhost, `*.local`, `*.internal`, private IP ranges, IPv6 literals) are rejected.

## Run locally

Requires Node.js 22.17 or newer. Rendering JavaScript pages locally needs Google Chrome installed (or `CHROME_PATH` pointing at a Chrome or Chromium binary).

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

To run the tests (offline: DNS and fetch are injected):

```bash
npm run selftest        # npx tsx scripts/selftest.ts
npm run test:patterns   # the original grouping cases on their own
```

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Keep the default settings and deploy. No environment variables are needed.
4. Optional: connect Upstash Redis so Read every page keeps going with the page closed (see [Reading in the background](#reading-in-the-background)).

The API routes run on the Node.js runtime with `maxDuration = 60`, which the Hobby plan allows. Set the project's Node.js version to 22.x (the default). The Chromium binary is bundled with the API routes through `outputFileTracingIncludes` in `next.config.ts`. The first JavaScript render after a cold start takes a few extra seconds while Chromium unpacks.

## Project layout

- `lib/guard.ts`: SSRF guard (hostname rules and DNS)
- `lib/fetcher.ts`: redirect-safe fetching (5 hops, guard on every hop, 3 MB cap, charset, bot-protection detection)
- `lib/robots.ts`: robots.txt parsing and matching
- `lib/crawl.ts`: input checks, sitemap reading (with lastmod and per-sitemap stats), fallback crawl, limits
- `lib/patterns.ts`: groups URLs into patterns (`groupByPattern`, also exported as `groupUrls`), placeholders and `matchPattern`
- `lib/site.ts` and `app/api/site/route.ts`: site checks, `POST { origin, patterns, sampleUrl }`
- `lib/extract/*.ts` and `app/api/analyse/route.ts`: page analysis, `POST { origin, pattern, urls (max 3), patterns (max 500) }`
- `lib/aggregate.ts`, `lib/issues.ts`, `lib/report.ts`, `lib/exports.ts`: per-pattern and site-wide aggregation, issue rules, the Markdown report and the exports (all browser-safe)
- `components/`: the analysis UI (site section, pattern tabs, link map, issues, export)
- `app/api/crawl/route.ts`: `POST { domain }`, returns `{ origin, source, sitemaps, sitemapStats, truncated, notes, total, groups }`. To keep responses small, URLs on `origin` are sent as paths (`/predictions/x`) and the page turns them back into full URLs.
- `lib/contents.ts`: the Read every page feature (title, meta tags, headings, schema types, links and main text for every listed page)
- `lib/render.ts`: starts headless Chromium and returns a page's HTML after its JavaScript has run
- `app/api/extract/route.ts`: `POST { urls, render }` (at most 10 URLs, or 4 with `render: true`), returns `{ pages }` in the same order
- `lib/store.ts`: Upstash Redis over REST, or memory when running locally
- `lib/jobs.ts` and `app/api/jobs/**`: background Read every page jobs. `POST /api/jobs { origin, items: [url, pattern][], identity }` returns `{ id }`; `GET /api/jobs/<id>` is the progress, `GET /api/jobs/<id>/results?offset=` pages through results, `GET /api/jobs/<id>/items` lists the job's pages, `POST /api/jobs/<id>/stop` stops it
- `app/page.tsx`: the interface; `app/contents.tsx` shows extracted contents and `app/ui.tsx` holds shared icons and helpers

## Adding storage later

Apart from the optional Redis for background jobs, no database is needed: results leave through the exports. If you want saved history, or to track how a site's pages and templates change over time (new patterns, pages added or removed, titles rewritten), that's when adding Postgres with Prisma makes sense.
