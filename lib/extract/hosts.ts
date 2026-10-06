/**
 * Third-party host dictionary. Each entry matches a host and its subdomains.
 * Add hosts here; categories are free text but keep to the ones below so the
 * UI groups them well.
 */

export type HostCategory =
  | "analytics"
  | "tag manager"
  | "ads"
  | "push"
  | "chat"
  | "consent"
  | "fonts"
  | "CDN"
  | "social"
  | "payments"
  | "sports data"
  | "affiliate network"
  | "other";

const HOSTS: [string, HostCategory, string][] = [
  // analytics
  ["google-analytics.com", "analytics", "Google Analytics"],
  ["analytics.google.com", "analytics", "Google Analytics"],
  ["plausible.io", "analytics", "Plausible"],
  ["static.cloudflareinsights.com", "analytics", "Cloudflare Web Analytics"],
  ["hotjar.com", "analytics", "Hotjar"],
  ["clarity.ms", "analytics", "Microsoft Clarity"],
  ["mc.yandex.ru", "analytics", "Yandex Metrica"],
  ["matomo.cloud", "analytics", "Matomo"],
  ["segment.com", "analytics", "Segment"],
  ["cdn.segment.com", "analytics", "Segment"],
  ["mixpanel.com", "analytics", "Mixpanel"],
  ["amplitude.com", "analytics", "Amplitude"],
  ["statcounter.com", "analytics", "StatCounter"],
  ["histats.com", "analytics", "Histats"],
  ["umami.is", "analytics", "Umami"],
  ["vercel-insights.com", "analytics", "Vercel Analytics"],
  ["va.vercel-scripts.com", "analytics", "Vercel Analytics"],
  ["stats.wp.com", "analytics", "Jetpack Stats"],
  ["newrelic.com", "analytics", "New Relic"],
  ["nr-data.net", "analytics", "New Relic"],
  ["sentry.io", "analytics", "Sentry"],
  ["ingest.sentry.io", "analytics", "Sentry"],
  // tag managers
  ["googletagmanager.com", "tag manager", "Google Tag Manager"],
  ["tags.tiqcdn.com", "tag manager", "Tealium"],
  // ads
  ["googlesyndication.com", "ads", "Google AdSense"],
  ["pagead2.googlesyndication.com", "ads", "Google AdSense"],
  ["doubleclick.net", "ads", "Google Ad Manager"],
  ["securepubads.g.doubleclick.net", "ads", "Google Ad Manager"],
  ["adservice.google.com", "ads", "Google Ads"],
  ["googleadservices.com", "ads", "Google Ads"],
  ["amazon-adsystem.com", "ads", "Amazon Ads"],
  ["taboola.com", "ads", "Taboola"],
  ["outbrain.com", "ads", "Outbrain"],
  ["mgid.com", "ads", "MGID"],
  ["propellerads.com", "ads", "PropellerAds"],
  ["adsterra.com", "ads", "Adsterra"],
  ["ezoic.net", "ads", "Ezoic"],
  ["ezojs.com", "ads", "Ezoic"],
  ["mediavine.com", "ads", "Mediavine"],
  ["adthrive.com", "ads", "Raptive"],
  ["media.net", "ads", "Media.net"],
  ["criteo.com", "ads", "Criteo"],
  ["criteo.net", "ads", "Criteo"],
  ["pubmatic.com", "ads", "PubMatic"],
  ["rubiconproject.com", "ads", "Magnite"],
  ["adnxs.com", "ads", "Xandr"],
  ["exoclick.com", "ads", "ExoClick"],
  ["popads.net", "ads", "PopAds"],
  ["a-ads.com", "ads", "A-Ads"],
  ["monetag.com", "ads", "Monetag"],
  ["highperformanceformat.com", "ads", "Adsterra"],
  // push
  ["onesignal.com", "push", "OneSignal"],
  ["cdn.onesignal.com", "push", "OneSignal"],
  ["pushengage.com", "push", "PushEngage"],
  ["webpushr.com", "push", "Webpushr"],
  ["pushwoosh.com", "push", "Pushwoosh"],
  ["sendpulse.com", "push", "SendPulse"],
  ["izooto.com", "push", "iZooto"],
  ["firebaseapp.com", "push", "Firebase"],
  // chat
  ["tawk.to", "chat", "Tawk.to"],
  ["intercom.io", "chat", "Intercom"],
  ["intercomcdn.com", "chat", "Intercom"],
  ["crisp.chat", "chat", "Crisp"],
  ["zendesk.com", "chat", "Zendesk"],
  ["zopim.com", "chat", "Zendesk Chat"],
  ["livechatinc.com", "chat", "LiveChat"],
  ["drift.com", "chat", "Drift"],
  ["tidio.co", "chat", "Tidio"],
  ["jivosite.com", "chat", "JivoChat"],
  // consent
  ["cookiebot.com", "consent", "Cookiebot"],
  ["cookielaw.org", "consent", "OneTrust"],
  ["onetrust.com", "consent", "OneTrust"],
  ["quantcast.com", "consent", "Quantcast Choice"],
  ["quantserve.com", "analytics", "Quantcast"],
  ["consensu.org", "consent", "IAB consent"],
  ["usercentrics.eu", "consent", "Usercentrics"],
  ["termly.io", "consent", "Termly"],
  ["iubenda.com", "consent", "iubenda"],
  ["fundingchoicesmessages.google.com", "consent", "Google Funding Choices"],
  // fonts
  ["fonts.googleapis.com", "fonts", "Google Fonts"],
  ["fonts.gstatic.com", "fonts", "Google Fonts"],
  ["use.typekit.net", "fonts", "Adobe Fonts"],
  ["fonts.bunny.net", "fonts", "Bunny Fonts"],
  ["use.fontawesome.com", "fonts", "Font Awesome"],
  ["kit.fontawesome.com", "fonts", "Font Awesome"],
  // CDNs
  ["cdnjs.cloudflare.com", "CDN", "cdnjs"],
  ["cdn.jsdelivr.net", "CDN", "jsDelivr"],
  ["unpkg.com", "CDN", "unpkg"],
  ["ajax.googleapis.com", "CDN", "Google Hosted Libraries"],
  ["code.jquery.com", "CDN", "jQuery CDN"],
  ["stackpath.bootstrapcdn.com", "CDN", "BootstrapCDN"],
  ["maxcdn.bootstrapcdn.com", "CDN", "BootstrapCDN"],
  ["cloudfront.net", "CDN", "Amazon CloudFront"],
  ["akamaihd.net", "CDN", "Akamai"],
  ["fastly.net", "CDN", "Fastly"],
  ["b-cdn.net", "CDN", "Bunny CDN"],
  ["wp.com", "CDN", "WordPress.com CDN"],
  ["i0.wp.com", "CDN", "Jetpack image CDN"],
  ["cloudinary.com", "CDN", "Cloudinary"],
  ["imgix.net", "CDN", "imgix"],
  ["ctfassets.net", "CDN", "Contentful"],
  ["sanity.io", "CDN", "Sanity"],
  ["shopifycdn.com", "CDN", "Shopify CDN"],
  ["cdn.shopify.com", "CDN", "Shopify CDN"],
  ["website-files.com", "CDN", "Webflow CDN"],
  ["wixstatic.com", "CDN", "Wix CDN"],
  ["squarespace-cdn.com", "CDN", "Squarespace CDN"],
  // social
  ["facebook.net", "social", "Meta"],
  ["connect.facebook.net", "social", "Meta Pixel / SDK"],
  ["facebook.com", "social", "Facebook"],
  ["platform.twitter.com", "social", "X (Twitter) widgets"],
  ["twitter.com", "social", "X (Twitter)"],
  ["x.com", "social", "X"],
  ["instagram.com", "social", "Instagram"],
  ["tiktok.com", "social", "TikTok"],
  ["analytics.tiktok.com", "analytics", "TikTok Pixel"],
  ["youtube.com", "social", "YouTube"],
  ["youtube-nocookie.com", "social", "YouTube"],
  ["ytimg.com", "social", "YouTube"],
  ["t.me", "social", "Telegram"],
  ["telegram.org", "social", "Telegram"],
  ["whatsapp.com", "social", "WhatsApp"],
  ["wa.me", "social", "WhatsApp"],
  ["pinterest.com", "social", "Pinterest"],
  ["linkedin.com", "social", "LinkedIn"],
  ["snap.licdn.com", "analytics", "LinkedIn Insight"],
  ["sharethis.com", "social", "ShareThis"],
  ["addtoany.com", "social", "AddToAny"],
  ["disqus.com", "social", "Disqus"],
  // payments
  ["js.stripe.com", "payments", "Stripe"],
  ["stripe.com", "payments", "Stripe"],
  ["paypal.com", "payments", "PayPal"],
  ["paypalobjects.com", "payments", "PayPal"],
  ["paystack.co", "payments", "Paystack"],
  ["js.paystack.co", "payments", "Paystack"],
  ["flutterwave.com", "payments", "Flutterwave"],
  ["checkout.flutterwave.com", "payments", "Flutterwave"],
  ["mpesa.com", "payments", "M-Pesa"],
  ["coinbase.com", "payments", "Coinbase Commerce"],
  ["nowpayments.io", "payments", "NOWPayments"],
  ["paddle.com", "payments", "Paddle"],
  ["lemonsqueezy.com", "payments", "Lemon Squeezy"],
  // sports data
  ["api-sports.io", "sports data", "API-Sports"],
  ["api-football.com", "sports data", "API-Football"],
  ["sportmonks.com", "sports data", "Sportmonks"],
  ["football-data.org", "sports data", "football-data.org"],
  ["sportradar.com", "sports data", "Sportradar"],
  ["betradar.com", "sports data", "Betradar"],
  ["livescore.com", "sports data", "LiveScore"],
  ["sofascore.com", "sports data", "Sofascore"],
  ["flashscore.com", "sports data", "Flashscore"],
  ["fotmob.com", "sports data", "FotMob"],
  ["thesportsdb.com", "sports data", "TheSportsDB"],
  ["the-odds-api.com", "sports data", "The Odds API"],
  ["oddsapi.io", "sports data", "Odds API"],
  ["statsperform.com", "sports data", "Stats Perform"],
  ["opta.net", "sports data", "Opta"],
  ["fixtures.today", "sports data", "Fixtures widgets"],
  ["scorebat.com", "sports data", "ScoreBat"],
  ["widgets.api-sports.io", "sports data", "API-Sports widgets"],
  // affiliate networks
  ["awin1.com", "affiliate network", "Awin"],
  ["prf.hn", "affiliate network", "Partnerize"],
  ["impact.com", "affiliate network", "Impact"],
  ["sjv.io", "affiliate network", "Impact"],
  ["tradedoubler.com", "affiliate network", "Tradedoubler"],
  ["cj.com", "affiliate network", "CJ"],
  ["dpbolvw.net", "affiliate network", "CJ"],
  ["anrdoezrs.net", "affiliate network", "CJ"],
  ["shareasale.com", "affiliate network", "ShareASale"],
  ["clickbank.net", "affiliate network", "ClickBank"],
  ["income-access.com", "affiliate network", "Income Access"],
  ["netrefer.com", "affiliate network", "NetRefer"],
  ["myaffiliates.com", "affiliate network", "MyAffiliates"],
  ["cellxpert.com", "affiliate network", "Cellxpert"],
  ["refpa.top", "affiliate network", "1xBet partners"],
  ["affiliates.bet9ja.com", "affiliate network", "Bet9ja affiliates"],
  ["partners.sportybet.com", "affiliate network", "SportyBet partners"],
  ["bet365affiliates.com", "affiliate network", "bet365 affiliates"],
  ["go.betway.com", "affiliate network", "Betway affiliates"],
  ["track.adform.net", "affiliate network", "Adform"],
  ["amzn.to", "affiliate network", "Amazon Associates"],
];

const INDEX = new Map(HOSTS.map(([host, category, name]) => [host, { category, name }]));

/** Looks up a host or any parent domain in the dictionary. */
export function classifyHost(host: string): { category: HostCategory; name: string } {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  for (let start = 0; start < parts.length - 1; start++) {
    const candidate = parts.slice(start).join(".");
    const hit = INDEX.get(candidate);
    if (hit) return hit;
  }
  return { category: "other", name: "" };
}

export const AFFILIATE_NETWORK_HOSTS = HOSTS.filter(([, category]) => category === "affiliate network").map(([host]) => host);
