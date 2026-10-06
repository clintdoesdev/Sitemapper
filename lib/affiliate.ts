/** Internal paths sites use to send visitors on to affiliates. Recorded, never requested. */
export const AFFILIATE_PATH = /^\/(?:go|out|visit|recommends|link|bet|refer|redirect|goto|click)\//i;

export function isAffiliatePath(url: string): boolean {
  try {
    return AFFILIATE_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
