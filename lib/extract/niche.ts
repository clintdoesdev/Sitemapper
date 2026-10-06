/**
 * Niche detection. Every dictionary lives in this file: add a niche by adding
 * an entry to NICHES, and extend the sports lists the same way.
 */

import { collapse, unique } from "./dom";
import type { NicheInfo, SportsSignals } from "./types";

type NicheDefinition = {
  name: string;
  /** Phrases in the page text; each distinct hit scores 1. */
  keywords: RegExp[];
  /** Schema types; each scores 3. */
  schema: string[];
  /** Matched against the URL path; scores 2. */
  url?: RegExp;
  /** CMS or framework names; each scores 2. */
  tech?: string[];
};

export const SPORTS_NICHE = "sports predictions/betting";

export const NICHES: NicheDefinition[] = [
  {
    name: SPORTS_NICHE,
    keywords: [
      /\bpredictions?\b/i, /\btips?\b/i, /\bodds\b/i, /\bbetting\b/i, /\bbet(?:s|ting)? slip\b/i, /\bfixtures?\b/i,
      /\bkick-?off\b/i, /\baccumulators?\b|\bacca\b/i, /\bbtts\b|both teams to score/i, /over\s?\d\.5/i,
      /correct score/i, /\bbookmakers?\b/i, /\bdouble chance\b/i, /\bhead to head\b|\bh2h\b/i, /\bleague table\b/i,
    ],
    schema: ["SportsEvent", "SportsTeam", "SportsOrganization"],
    url: /predict|tips|odds|betting|fixture|match|football|soccer|livescore/i,
  },
  {
    name: "e-commerce",
    keywords: [
      /add to (?:cart|basket|bag)/i, /\bbuy now\b/i, /\bin stock\b/i, /\bout of stock\b/i, /\bcheckout\b/i,
      /free (?:shipping|delivery)/i, /\bshopping cart\b/i, /\bsku\b/i, /\breturns? policy\b/i, /\bwishlist\b/i,
    ],
    schema: ["Product", "Offer", "AggregateOffer", "ItemList"],
    url: /\/(?:product|products|shop|store|cart|collections?|category)\b/i,
    tech: ["Shopify", "WooCommerce"],
  },
  {
    name: "news/blog",
    keywords: [
      /\bpublished\b/i, /\bupdated\b/i, /\bread more\b/i, /\bcomments?\b/i, /\bmin(?:ute)?s? read\b/i,
      /\bshare (?:this|on)\b/i, /\brelated (?:posts|articles|stories)\b/i, /\bnewsletter\b/i, /\bauthor\b/i,
    ],
    schema: ["Article", "NewsArticle", "BlogPosting", "Blog"],
    url: /\/(?:blog|news|articles?|posts?|\d{4}\/\d{2})\b/i,
    tech: ["WordPress", "Ghost"],
  },
  {
    name: "SaaS",
    keywords: [
      /free trial/i, /\bstart (?:for )?free\b/i, /\bbook a demo\b|\brequest a demo\b/i, /\bper (?:month|user)\b|\/mo\b/i,
      /\bintegrations?\b/i, /\bapi\b/i, /\bdashboard\b/i, /\bpricing\b/i, /\bsign up\b/i, /\bteams?\b/i,
    ],
    schema: ["SoftwareApplication", "WebApplication"],
    url: /\/(?:pricing|features|integrations|docs|app|signup)\b/i,
  },
];

export const BOOKMAKERS = [
  "Bet9ja", "SportyBet", "BetKing", "1xBet", "MSport", "Betway", "Betika", "22Bet", "Melbet", "bet365",
  "William Hill", "Paddy Power", "Sky Bet", "Betfair", "DraftKings", "FanDuel", "BetMGM", "Stake", "Unibet",
  "Ladbrokes", "Coral", "888sport", "Bwin", "Betano", "Parimatch", "NairaBet", "Merrybet", "BangBet", "Betpawa",
  "Odibets", "Mozzartbet", "SportPesa", "Hollywoodbets", "Supabets", "Sportingbet", "Betclic", "Pinnacle",
  "Caesars", "PointsBet", "BetRivers", "Bovada", "Mostbet", "Linebet", "Helabet", "Paripesa", "BC.Game",
];

const MARKETS: [string, RegExp][] = [
  ["1X2", /\b1x2\b/i],
  ["double chance", /double chance/i],
  ["draw no bet", /draw no bet|\bdnb\b/i],
  ["BTTS/GG/NG", /\bbtts\b|both teams to score|\bgg\/ng\b|\bgg\b(?=[\s,.)])|\bng\b(?=[\s,.)])/i],
  ["over/under", /\b(?:over|under|o\/u|ov|un)\s?\d{1,2}\.5\b/i],
  ["correct score", /correct score/i],
  ["HT/FT", /\bht\s?\/\s?ft\b|half.?time\s?\/\s?full.?time/i],
  ["handicap", /handicap/i],
  ["corners", /\bcorners?\b/i],
  ["cards", /\b(?:yellow|red|booking)\s?cards?\b|\bcards? market/i],
  ["win either half", /win either half/i],
];
const TIMEZONES = /\b(?:WAT|GMT|UTC|BST|CET|CEST|EAT|SAST|CAT|EST|EDT|CST|PST|PDT|IST|WAST|AEST)\b(?:\s?[+-]\s?\d{1,2})?|\bUTC\s?[+-]\s?\d{1,2}\b/g;
const KICKOFF = /\b(?:[01]?\d|2[0-3])(?::|h)[0-5]\d(?:\s?(?:am|pm))?\b/gi;
/** Words that follow a fixture in titles but aren't part of the team name. */
const FIXTURE_TAIL = /\s+(?:Prediction|Predictions|Preview|Tips?|Odds|Betting|Match|Live|Stream|Result|Results|Score|Lineups?|H2H|Today|Tonight)\b.*$/i;
const TIP_LABEL = /\b(?:our |free |best |sure |daily )?(?:tips?|predictions?|picks?|best bets?|banker|sure (?:tips?|bets?|odds))\b/gi;
const ACCA_TERMS: [string, RegExp][] = [
  ["acca", /\bacca\b/i],
  ["accumulator", /\baccumulators?\b/i],
  ["total odds", /total odds/i],
  ["ticket", /\btickets?\b/i],
  ["rollover", /\broll-?over\b/i],
  ["booking code", /booking code/i],
];
const BOOKING_CODE = /\b(?:booking code|code|share code)\s*[:#-]?\s*([A-Z0-9]{5,12})\b/g;

function oddsLike(text: string): SportsSignals["odds"] {
  const examples: string[] = [];
  const formats = new Set<string>();
  let count = 0;
  const push = (value: string, format: string) => {
    count++;
    formats.add(format);
    if (examples.length < 10 && !examples.includes(value)) examples.push(value);
  };
  for (const match of text.matchAll(/(?<![\d.,/])([1-9]\d?\.\d{2})(?!\d|[.,/]\d|\s?%)/g)) {
    const value = Number(match[1]);
    if (value >= 1.01 && value <= 50) push(match[1], "decimal");
  }
  for (const match of text.matchAll(/(?<![\d/])(\d{1,2}\/\d{1,2})(?![\d/])/g)) {
    const [a, b] = match[1].split("/").map(Number);
    if (b > 0 && b <= 20 && a > 0 && a <= 40) push(match[1], "fractional");
  }
  for (const match of text.matchAll(/(?<![\w.])([+-][1-9]\d{2,3})(?![\d.%])/g)) push(match[1], "American");
  return { count, examples, formats: [...formats] };
}

function sportsSignals(text: string, titleAndH1: string): SportsSignals {
  const fixtures = unique(
    [...titleAndH1.matchAll(/([\p{Lu}][\p{L}.'&-]*(?:\s[\p{Lu}][\p{L}.'&-]*){0,3})\s+(?:vs\.?|v\.?)\s+([\p{Lu}][\p{L}.'&-]*(?:\s[\p{Lu}][\p{L}.'&-]*){0,3})/gu)].map(
      (match) => `${match[1]} vs ${match[2].replace(FIXTURE_TAIL, "")}`,
    ),
  ).slice(0, 10);
  const results: Record<string, number> = {};
  for (const word of ["won", "lost", "void", "pending"]) {
    const count = (text.match(new RegExp(`\\b${word}\\b`, "gi")) ?? []).length;
    if (count) results[word] = count;
  }
  return {
    fixtures,
    kickoffTimes: unique([...text.matchAll(KICKOFF)].map((m) => m[0].trim())).slice(0, 10),
    timezones: unique([...text.matchAll(TIMEZONES)].map((m) => collapse(m[0]))).slice(0, 10),
    markets: MARKETS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
    odds: oddsLike(text),
    bookmakers: BOOKMAKERS.filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)),
    tipLabels: unique([...text.matchAll(TIP_LABEL)].map((m) => m[0].toLowerCase())).slice(0, 10),
    confidence: unique([...text.matchAll(/\b(\d{1,3})\s?%/g)].map((m) => `${m[1]}%`).filter((v) => Number.parseInt(v) <= 100)).slice(0, 10),
    accaTerms: ACCA_TERMS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name),
    bookingCodes: unique([...text.matchAll(BOOKING_CODE)].map((m) => m[1]).filter((code) => /\d/.test(code) && /[A-Z]/.test(code))).slice(0, 10),
    results,
  };
}

export function detectNiche(input: {
  text: string;
  title: string;
  h1: string;
  url: string;
  schemaTypes: string[];
  tech: string[];
}): NicheInfo {
  const scores: Record<string, number> = {};
  const reasons: Record<string, string[]> = {};
  let path = "";
  try {
    path = new URL(input.url).pathname;
  } catch {
    path = input.url;
  }
  const sample = `${input.title}\n${input.h1}\n${input.text}`.slice(0, 200_000);
  for (const niche of NICHES) {
    let score = 0;
    const why: string[] = [];
    for (const keyword of niche.keywords) {
      const match = keyword.exec(sample);
      if (match) {
        score += 1;
        why.push(`"${match[0].toLowerCase()}"`);
      }
    }
    for (const type of niche.schema) {
      if (input.schemaTypes.includes(type)) {
        score += 3;
        why.push(`${type} schema`);
      }
    }
    if (niche.url?.test(path)) {
      score += 2;
      why.push("URL path");
    }
    for (const tech of niche.tech ?? []) {
      if (input.tech.includes(tech)) {
        score += 2;
        why.push(tech);
      }
    }
    scores[niche.name] = score;
    reasons[niche.name] = why;
  }
  const [best, bestScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] ?? ["other", 0];
  const niche = bestScore >= 4 ? best : "other";
  return {
    niche,
    scores,
    signals: niche === "other" ? [] : reasons[niche].slice(0, 12),
    sports: niche === SPORTS_NICHE ? sportsSignals(sample, `${input.title}\n${input.h1}`) : null,
  };
}
