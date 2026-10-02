// Run with: npm run test:patterns
import assert from "node:assert/strict";
import { groupByPattern, textTemplate } from "../lib/patterns.ts";

const base = "https://example.com";

function patternCounts(urls: string[]): Record<string, number> {
  return Object.fromEntries(groupByPattern(urls).map((g) => [g.pattern, g.count]));
}

// Match pages collapse into one template.
assert.deepEqual(
  patternCounts([
    `${base}/predictions/arsenal-vs-chelsea`,
    `${base}/predictions/liverpool-vs-everton`,
    `${base}/predictions/real-madrid-vs-barcelona`,
    `${base}/predictions/inter-vs-milan`,
  ]),
  { "/predictions/*": 4 },
);

// League pages keep the repeated trailing segment.
const leagues = [
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1",
  "eredivisie",
  "primeira-liga",
  "championship",
];
const leagueUrls = leagues.flatMap((league) =>
  ["table", "fixtures", "results"].map((page) => `${base}/league/${league}/${page}`),
);
assert.deepEqual(patternCounts(leagueUrls), {
  "/league/*/table": 8,
  "/league/*/fixtures": 8,
  "/league/*/results": 8,
});

// Dates become wildcards.
assert.deepEqual(patternCounts([`${base}/blog/2026/09/slug`]), { "/blog/*/*/*": 1 });

// Short static pages stay literal; long one-off slugs do not.
assert.deepEqual(
  patternCounts([
    `${base}/`,
    `${base}/about`,
    `${base}/privacy-policy`,
    `${base}/arsenal-vs-chelsea-prediction-tips-today`,
  ]),
  { "/": 1, "/about": 1, "/privacy-policy": 1, "/*": 1 },
);

// A section index stays literal when it has child pages.
assert.deepEqual(
  patternCounts([`${base}/news-and-match-previews`, `${base}/news-and-match-previews/x`]),
  { "/news-and-match-previews": 1, "/news-and-match-previews/*": 1 },
);

// Title templates keep the shared words and mark what changes.
assert.equal(
  textTemplate([
    "Arsenal vs Chelsea Prediction, Tips & Odds | Tiporacle",
    "Inter vs Milan Prediction, Tips & Odds | Tiporacle",
    "Real Madrid vs Barcelona Prediction, Tips & Odds | Tiporacle",
  ]),
  "{…} vs {…} Prediction, Tips & Odds | Tiporacle",
);
assert.equal(textTemplate(["About us", "About us"]), "About us");
assert.equal(textTemplate(["Alpha", "Beta"]), null);
assert.equal(textTemplate(["Only one"]), null);

console.log("All pattern tests passed.");
