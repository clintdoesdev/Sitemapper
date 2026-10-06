import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard. Every URL Sitemapper fetches goes through checkHost, which
 * rejects local hostnames and literal private addresses, then resolves the
 * name and rejects it if any address it points to is private.
 */

export type LookupAddress = { address: string; family: number };
export type Lookup = (hostname: string) => Promise<LookupAddress[]>;

/** Injectable so tests can run offline. */
export const guardConfig: { lookup: Lookup } = {
  lookup: (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
};

const PRIVATE_ADDRESS_MESSAGE =
  "Private and local IP addresses can't be mapped. Enter a public domain, like example.com.";

function ipv4Parts(address: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return null;
  const parts = address.split(".").map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function isPrivateIpv4(address: string): boolean {
  const parts = ipv4Parts(address);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 || // unspecified and "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Expands an IPv6 address into eight 16-bit groups, or null if it isn't one. */
function ipv6Groups(address: string): number[] | null {
  let value = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // An embedded IPv4 tail (::ffff:10.0.0.1) becomes two hex groups.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (v4) {
    const parts = ipv4Parts(v4[1]);
    if (!parts) return null;
    value = value.slice(0, -v4[1].length) + ((parts[0] << 8) | parts[1]).toString(16) + ":" + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return false;
  if (groups.every((group) => group === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses.
  const mapped = groups.slice(0, 5).every((group) => group === 0) && (groups[5] === 0xffff || groups[5] === 0);
  if (mapped) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
    return isPrivateIpv4(v4);
  }
  return false;
}

/** True for loopback, private, link-local, CGNAT, unspecified and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address.replace(/^\[|\]$/g, "").split("%")[0]);
  if (kind === 4) return isPrivateIpv4(address);
  if (kind === 6) return isPrivateIpv6(address);
  return false;
}

/** Returns an error message if the hostname must not be fetched, otherwise null. No DNS. */
export function blockedHostReason(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":")) {
    return "IP addresses in IPv6 form aren't supported. Enter the site's domain name instead.";
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Local addresses can't be mapped. Enter a public domain, like example.com.";
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return "Internal network addresses can't be mapped. Enter a public domain, like example.com.";
  }
  if (ipv4Parts(host)) {
    return isPrivateIpv4(host) ? PRIVATE_ADDRESS_MESSAGE : null;
  }
  if (!host.includes(".")) {
    return "That domain is missing its ending, like .com or .co.uk. Enter the full domain.";
  }
  return null;
}

const resolved = new Map<string, { reason: string | null; expires: number }>();
const CACHE_MS = 60_000;

/**
 * Full check: hostname rules, then DNS. A name that doesn't resolve is
 * allowed through so the request fails with a normal network error.
 */
export async function checkHost(hostname: string): Promise<string | null> {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const quick = blockedHostReason(host);
  if (quick) return quick;
  if (ipv4Parts(host)) return null;

  const cached = resolved.get(host);
  if (cached && cached.expires > Date.now()) return cached.reason;

  let reason: string | null = null;
  try {
    const addresses = await guardConfig.lookup(host);
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      reason = `${host} points to a private or local address, so it can't be fetched.`;
    }
  } catch {
    reason = null;
  }
  resolved.set(host, { reason, expires: Date.now() + CACHE_MS });
  return reason;
}

/** Forget cached lookups. Used by tests. */
export function clearGuardCache() {
  resolved.clear();
}

export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** True when two hosts are the same site, treating www and the bare domain as one. */
export function sameSite(a: string, b: string): boolean {
  return bareHost(a) === bareHost(b);
}
