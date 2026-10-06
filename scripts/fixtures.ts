/** Hand-written HTML fixtures for the selftest. */

export function wordpressPrediction(home: string, away: string, day: number, extra = ""): string {
  const date = `${day} Oct 2026`;
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${home} vs ${away} Prediction, Tips &amp; Odds – ${date}</title>
<meta name="description" content="${home} vs ${away} prediction for ${date}: our expert tip, odds from Bet9ja and SportyBet, and a 1X2 pick.">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WordPress 6.8">
<link rel="canonical" href="https://tips.example/predictions/${home.toLowerCase()}-vs-${away.toLowerCase()}/">
<meta property="og:title" content="${home} vs ${away} Prediction">
<meta property="og:image" content="https://tips.example/wp-content/uploads/og-default.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" hreflang="en" href="https://tips.example/predictions/${home.toLowerCase()}-vs-${away.toLowerCase()}/">
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="stylesheet" href="https://tips.example/wp-content/themes/tipster/style.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="alternate" type="application/rss+xml" title="Feed" href="https://tips.example/feed/">
<!-- This site is optimized with the Yoast SEO plugin v23 -->
<script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Tips","url":"https://tips.example/"},{"@type":"SportsEvent","name":"${home} vs ${away}","startDate":"2026-10-${day}T19:00:00+01:00","homeTeam":{"@type":"SportsTeam","name":"${home}"},"awayTeam":{"@type":"SportsTeam","name":"${away}"}},{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home"},{"@type":"ListItem","position":2,"name":"Predictions"},{"@type":"ListItem","position":3,"name":"${home} vs ${away}"}]},{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Who will win ${home} vs ${away}?","acceptedAnswer":{"@type":"Answer","text":"We back ${home}."}},{"@type":"Question","name":"Is there a hidden question?","acceptedAnswer":{"@type":"Answer","text":"Yes."}}]}]}</script>
<script type="application/ld+json">{"@type": "Organization", broken json</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<script>window.dataLayer=[];gtag('config','G-ABC1234567');</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"></script>
<script src="https://cdn.onesignal.com/sdks/OneSignalSDK.js" defer></script>
<script>fetch("https://v3.football.api-sports.io/fixtures?date=2026-10-${day}")</script>
</head>
<body class="post-template">
<header class="site-header"><nav><a href="/">Home</a> <a href="/predictions/">Predictions</a> <a href="/login/">Login</a> <a href="/register/">Sign up</a> <a href="/vip/">VIP tips</a></nav></header>
<nav class="breadcrumb" aria-label="breadcrumb"><a href="/">Home</a> › <a href="/predictions/">Predictions</a> › ${home} vs ${away}</nav>
<main id="content" class="site-main">
<div class="ad-slot top-banner"><ins class="adsbygoogle" data-ad-slot="111"></ins></div>
<article class="post">
<h1>${home} vs ${away} Prediction</h1>
<p class="byline">By <a rel="author" href="/author/sam/">Sam Tipster</a>. Updated ${date}.</p>
<time datetime="2026-10-${day}T08:00:00Z">${date}</time>
<p>${home} host ${away} on ${date} with kick-off at 19:00 WAT. ${home} have won four of their last five home games and scored in every one of them.</p>
<p>Our prediction for ${home} vs ${away} is a home win, and we also like both teams to score at odds of 1.85 with Bet9ja.</p>
<p>This preview is written by the editorial team and checked before every match day so the tips stay accurate and fair.</p>
<h2>Our prediction</h2>
<p>Tip: ${home} to win (1X2) at 2.10, confidence 72%. Over 2.5 goals looks likely given recent form for both clubs.</p>
<h2>Head to head</h2>
<table class="h2h"><thead><tr><th>Date</th><th>Home</th><th>Score</th><th>Away</th></tr></thead><tbody><tr><td>2025</td><td>${home}</td><td>2-1</td><td>${away}</td></tr><tr><td>2024</td><td>${away}</td><td>0-0</td><td>${home}</td></tr></tbody></table>
<div class="sponsor-box"><a href="/go/bet9ja/" rel="nofollow sponsored">Bet with Bet9ja</a> <a href="https://www.bet365.com/?affid=99&utm_source=tips" rel="sponsored">bet365</a></div>
<h2>Accumulator</h2>
<p>Add this to your acca: total odds 5.40, booking code B9X7K2Q. Last week's ticket won.</p>
<h2>FAQ</h2>
<details><summary>Who will win ${home} vs ${away}?</summary><p>We back ${home}.</p></details>
<img src="/wp-content/uploads/${home.toLowerCase()}.webp" alt="${home} crest" width="64" height="64" loading="lazy">
<img src="http://tips.example/wp-content/uploads/stadium.jpg">
${extra}
<p>Related: <a href="/predictions/lyon-vs-psg/">Lyon vs PSG</a> <a href="/league/premier-league/table/">Premier League table</a> <a href="/secret-page/">Secret</a> <a href="/league/premier-league/table/?season=2026">Last season</a></p>
</article>
</main>
<aside class="sidebar"><h3>Top bookmakers</h3><a href="/go/sportybet/">SportyBet</a></aside>
<footer class="site-footer"><p>18+ only. Gamble responsibly. BeGambleAware.org. Licensed by the National Lottery Regulatory Commission.</p><a href="/privacy-policy/">Privacy</a> <a href="/terms/">Terms</a> <a href="/about/">About us</a> <a href="/contact/">Contact</a> <a href="https://t.me/tipschannel">Telegram</a> <a href="https://wa.me/2348000000000">WhatsApp</a> <a href="https://play.google.com/store/apps/details?id=tips">App</a></footer>
<form class="newsletter"><input type="email" name="email"><button>Subscribe</button></form>
</body>
</html>`;
}

export function nextAppRouterPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>Pricing | Acme</title>
<meta name="description" content="Plans for teams of every size."/>
<link rel="stylesheet" href="/_next/static/css/app.css"/>
<script src="/_next/static/chunks/webpack.js" async=""></script>
<script src="/_next/static/chunks/main-app.js" async=""></script>
</head><body><div id="__next"><main><h1>Pricing</h1><p>Start your free trial today and connect every integration your team uses with our API and dashboard.</p><p>Plans start at $29 per month for small teams.</p></main></div>
<script>self.__next_f=self.__next_f||[];self.__next_f.push([0]);self.__next_f.push([1,"https://api.acme.example/v1/plans"])</script>
</body></html>`;
}

export function clientRenderedShell(): string {
  return `<!doctype html><html><head><title>App</title><script src="/static/js/main.123.js"></script><script src="/static/js/vendor.456.js"></script></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>`;
}

export const cloudflareChallenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>`;
