import { checkHost, sameSite } from "./guard";

/** A request body problem; the route answers 400 with this message. */
export class ValidationError extends Error {}

export const MAX_PATTERNS = 500;

/** An http(s) origin on a public host, like "https://example.com". */
export async function parseOrigin(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) throw new ValidationError("Send the mapped site's origin.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ValidationError("The origin isn't a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError("The origin must be http or https.");
  const reason = await checkHost(url.hostname);
  if (reason) throw new ValidationError(reason);
  return url.origin;
}

export function parsePatterns(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError("patterns must be a list.");
  if (value.length > MAX_PATTERNS) throw new ValidationError(`Send at most ${MAX_PATTERNS} patterns.`);
  return value.filter((pattern): pattern is string => typeof pattern === "string" && pattern.startsWith("/") && pattern.length <= 500);
}

/** A URL on the mapped site (www and the bare domain count as the same). Anything else is a 400. */
export function parseSiteUrl(value: unknown, siteHost: string): string {
  if (typeof value !== "string") throw new ValidationError("URLs must be strings.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(`Not a valid URL: ${value.slice(0, 200)}`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !sameSite(url.hostname, siteHost)) {
    throw new ValidationError(`Only URLs on ${siteHost} can be analysed: ${value.slice(0, 200)}`);
  }
  url.hash = "";
  return url.href;
}
