/**
 * robots.txt parsing and rule matching (regex based, RFC 9309 style):
 * groups of user-agents, Allow/Disallow with * wildcards and $ anchors,
 * longest matching rule wins, Allow wins a tie.
 */

export type RobotsRule = { allow: boolean; path: string };

export type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
};

export type Robots = {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** Whether `url` may be fetched by `agent` (defaults to Sitemapper's token). */
  isAllowed: (url: string, agent?: string) => boolean;
};

/** Sitemapper's product token, matched against User-agent lines. */
export const SITEMAPPER_AGENT = "sitemapperbot";

export const AI_BOTS = ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "PerplexityBot", "Bytespider"];

type CompiledRule = RobotsRule & { regex: RegExp; length: number };

function ruleToRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = anchored ? path.slice(0, -1) : path;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

function compile(rules: RobotsRule[]): CompiledRule[] {
  return rules.map((rule) => ({ ...rule, regex: ruleToRegex(rule.path), length: rule.path.length }));
}

/** The groups that apply to an agent token: its own groups, else the * groups. */
export function groupsFor(groups: RobotsGroup[], agent: string): RobotsGroup[] {
  const token = agent.toLowerCase();
  const own = groups.filter((group) =>
    group.agents.some((name) => name !== "*" && (token === name || token.startsWith(name))),
  );
  return own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
}

/** Longest-match decision for a path against a set of rules. */
export function matchRules(rules: CompiledRule[], path: string): boolean {
  let best: CompiledRule | null = null;
  for (const rule of rules) {
    if (!rule.regex.test(path)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export function parseRobots(text: string, origin: string): Robots {
  const sitemaps: string[] = [];
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let inRules = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === "sitemap") {
      try {
        sitemaps.push(new URL(value, origin).href);
      } catch {
        // Ignore malformed sitemap lines.
      }
      continue;
    }
    if (field === "user-agent") {
      // A user-agent line after rules starts a new group.
      if (!current || inRules) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        inRules = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      inRules = true;
      if (value) current.rules.push({ allow: field === "allow", path: value });
    } else if (field === "crawl-delay") {
      inRules = true;
      const delay = Number(value);
      if (Number.isFinite(delay)) current.crawlDelay = delay;
    }
  }

  const compiled = new Map<string, CompiledRule[]>();
  const rulesFor = (agent: string) => {
    let rules = compiled.get(agent);
    if (!rules) {
      rules = compile(groupsFor(groups, agent).flatMap((group) => group.rules));
      compiled.set(agent, rules);
    }
    return rules;
  };

  const isAllowed = (url: string, agent: string = SITEMAPPER_AGENT): boolean => {
    let path: string;
    try {
      const parsed = new URL(url, origin);
      path = parsed.pathname + parsed.search;
    } catch {
      return false;
    }
    if (path === "/robots.txt") return true;
    return matchRules(rulesFor(agent.toLowerCase()), path);
  };

  return { groups, sitemaps: [...new Set(sitemaps)], isAllowed };
}

export type AiBotAccess = { bot: string; access: "blocked" | "partly blocked" | "allowed"; ownGroup: boolean };

/** How robots.txt treats the common AI crawlers. */
export function aiBotAccess(robots: Robots): AiBotAccess[] {
  return AI_BOTS.map((bot) => {
    const token = bot.toLowerCase();
    const own = robots.groups.some((group) => group.agents.some((name) => name !== "*" && token.startsWith(name)));
    const rules = groupsFor(robots.groups, token).flatMap((group) => group.rules);
    const blockedRoot = !robots.isAllowed("/", token);
    const anyDisallow = rules.some((rule) => !rule.allow);
    return {
      bot,
      access: blockedRoot ? "blocked" : anyDisallow ? "partly blocked" : "allowed",
      ownGroup: own,
    };
  });
}
