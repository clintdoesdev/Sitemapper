import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for rendering JavaScript pages. Kept out of the bundle,
  // and its compressed binary is shipped with the routes that use it.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/crawl": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/extract": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/screenshot": ["./node_modules/@sparticuz/chromium/bin/**"],
    // Background jobs open JavaScript and blocked pages in the browser too.
    "/api/jobs": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/jobs/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
