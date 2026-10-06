import type { PageAnalysis } from "./extract/types";

/** Keep well under Vercel's 4.5 MB response limit. */
export const MAX_RESPONSE_BYTES = 3_500_000;

/**
 * Shrinks a response that is too big: first raw JSON-LD blocks, then
 * sentences and long lists. Adds a note saying what was cut.
 */
export function fitResponse<T extends { pages: PageAnalysis[] }>(payload: T): T & { trimmed: string[] } {
  const trimmed: string[] = [];
  const size = () => Buffer.byteLength(JSON.stringify(payload));
  if (size() > MAX_RESPONSE_BYTES) {
    for (const page of payload.pages) {
      for (const block of page.data?.schema.blocks ?? []) {
        if (block.raw.length > 2_000) {
          block.raw = block.raw.slice(0, 2_000);
          block.rawTruncated = true;
        }
      }
    }
    trimmed.push("Raw JSON-LD blocks were cut to 2,000 characters to keep the response small.");
  }
  if (size() > MAX_RESPONSE_BYTES) {
    for (const page of payload.pages) {
      if (!page.data) continue;
      page.data.structure.sentences = page.data.structure.sentences.slice(0, 60);
      page.data.links.unmatchedInternal = page.data.links.unmatchedInternal.slice(0, 10);
      page.data.tech.thirdParties = page.data.tech.thirdParties.slice(0, 50);
      page.headers = {};
    }
    trimmed.push("Sentences, unmatched links, third parties and headers were shortened to keep the response small.");
  }
  return { ...payload, trimmed };
}
