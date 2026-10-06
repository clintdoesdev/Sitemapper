# Sitemapper

Enter any domain and get every page the site publishes, plus each page's contents, as a spreadsheet. Pages are grouped by URL shape, so `/blog/how-to-x` and `/blog/why-y` show up together as `/blog/*`.

## Using it

1. **Find pages.** Type a domain. Sitemapper reads the site's sitemaps (or follows links from the homepage when there are none) and lists every page.
2. **Get page contents.** Reads up to 10 pages from each URL group (pick 3, 5, 10 or All under **Pages from each group**), spread from the first page in the group to the last, so you get every kind of page without waiting for thousands of near-identical ones. For each page it reads the title, meta description, H1, canonical, robots meta, headings, JSON-LD schema types, link counts, word count and main text (up to 32,000 characters, the most a spreadsheet cell holds).
3. **Download.** **Spreadsheet (CSV)** or **JSON**: one row per page that was read, with its contents. Pages that couldn't be read are left out, so the file is clean; **The pages that couldn't be read, and why** downloads those separately. **Just the page links** gives every URL on the site and its pattern, without contents.

You can stop at any time; pressing Get page contents again continues with the pages not read yet.

## Getting past blocks

Each page is tried in order until one works:

1. A plain request as `SitemapperBot/1.0 (site structure study tool)`.
2. If the site refuses that (401/403 or a bot-protection page), the same request as a regular desktop Chrome browser.
3. If it's still refused, or the page builds its content with JavaScript, it's opened in a real headless Chrome browser.

Finding pages works the same way: if the site refuses SitemapperBot and almost nothing is found, it's mapped again as a regular browser.

Some things are never done: CAPTCHAs and challenge screens (like Cloudflare's "checking your browser") aren't solved, forms aren't submitted and nothing logs in. robots.txt is respected, affiliate and outbound redirect paths (`/go/`, `/out/`, `/visit/`, `/recommends/`) are never requested, and when a site answers 429 (too many requests) everything pauses for as long as it asks (up to a minute). Pages that failed for temporary reasons (server errors, timeouts, 429) get two more tries, after 3 and 10 seconds.

Every URL goes through an SSRF guard: local and private hostnames are rejected, and names are resolved so that any private, loopback, link-local, CGNAT or IPv6 local address is refused, on every redirect hop and on every request a page makes in the headless browser. API routes reject requests from other origins.

## Reading in the background

Without storage, **Get page contents** runs from the open page: close the tab or let your phone sleep and it stops. Connect a free Upstash Redis database and it runs on the server instead:

1. In your Vercel project, open the **Storage** tab, choose **Upstash for Redis** (from the Marketplace), create a free database and connect it to the project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the Upstash console work too.)
2. Redeploy.

Press it and the address bar gets a job link (`/?job=…`), also shown under the progress bar with a **Copy link** button. Close the page whenever you like. Open the link later, on any device, to see how far it got, and the downloads give everything read so far. Jobs and their results are kept for 7 days.

How it works: the server reads in slices of about 50 seconds (Vercel's Hobby plan stops a function after 60). Each slice saves its progress to Redis and then calls the app's own `/api/jobs/<id>/run` to start the next one. If a slice is ever lost (a crash or a failed hand-over), opening the job link restarts it from the last saved step. The same politeness rules apply as in the browser: robots.txt is read once per job and respected, affiliate paths are never requested, a 429 pauses the job for as long as the site asks (up to a minute), temporary failures get two more tries, and pages that block tools or need JavaScript get a second read in a real browser. At most 3 jobs run at once on one deployment.

On preview deployments behind Vercel Deployment Protection, the self-call that starts each slice is refused unless you add a **Protection Bypass for Automation** secret (Vercel adds it as `VERCEL_AUTOMATION_BYPASS_SECRET`, which Sitemapper sends along). The production domain isn't protected by default, so it works there without this.

Running locally with `npm run dev`, jobs are kept in memory without any setup and are lost when the server restarts.

## Limits

| | |
| --- | --- |
| Sitemaps read | 60 |
| URLs collected | 50,000 |
| Pages crawled (when there's no sitemap) | 300, 4 at a time |
| Time to find pages | 50 seconds in total, 10 seconds per request |
| Get page contents (from the open page) | 5,000 pages per run, 20 per request, 4 requests at a time, each reading 6 pages at once |
| Get page contents (in the background) | 5,000 pages per run, 80 pages per step with 20 at once, slices of about 50 seconds, 3 jobs at a time, kept 7 days |
| Real-browser reads | 6 pages per request, 3 tabs at a time, 15 seconds per page |
| Page size | 3 MB |

The CSV starts with a UTF-8 byte order mark so Excel shows accents and dashes correctly. Headless Chrome uses [`puppeteer-core`](https://pptr.dev) and [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium); locally it uses your installed Google Chrome, or `CHROME_PATH`.

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
4. Optional: connect Upstash Redis so Get page contents keeps going with the page closed (see [Reading in the background](#reading-in-the-background)).

The API routes run on the Node.js runtime with `maxDuration = 60`, which the Hobby plan allows. Set the project's Node.js version to 22.x (the default). The Chromium binary is bundled with the API routes through `outputFileTracingIncludes` in `next.config.ts`. The first JavaScript render after a cold start takes a few extra seconds while Chromium unpacks.

## Project layout

- `lib/guard.ts`: SSRF guard (hostname rules and DNS)
- `lib/fetcher.ts`: redirect-safe fetching (5 hops, guard on every hop, 3 MB cap, charset, bot-protection detection)
- `lib/robots.ts`: robots.txt parsing and matching
- `lib/crawl.ts` and `app/api/crawl/route.ts`: finding pages (sitemaps, fallback crawl). `POST { domain }` returns `{ origin, source, sitemaps, truncated, notes, total, groups }`, with URLs on `origin` sent as paths
- `lib/patterns.ts`: groups URLs into patterns
- `lib/contents.ts` and `app/api/extract/route.ts`: reading pages. `POST { urls, render }` (at most 20 URLs, or 6 with `render: true`) returns `{ pages }` in the same order
- `lib/render.ts`: headless Chrome
- `lib/store.ts`: Upstash Redis over REST, or memory when running locally
- `lib/jobs.ts` and `app/api/jobs/**`: background runs. `POST /api/jobs { origin, items: [url, pattern][] }` returns `{ id }`; `GET /api/jobs/<id>` is the progress, `GET /api/jobs/<id>/results?offset=` pages through results, `GET /api/jobs/<id>/items` lists the job's pages, `POST /api/jobs/<id>/stop` stops it
- `app/page.tsx`: the interface; `app/contents.tsx` holds the progress, job link and download formats; `app/ui.tsx` shared icons and helpers
