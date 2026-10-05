import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/** Unpacked fake helper extension that replays the documented button labels offline. */
export const FIXTURE_PAGE_HELPER_DIR = fileURLToPath(
  new URL("../fixtures/page-helper", import.meta.url),
);

export const CHROMIUM_INSTALL_COMMAND =
  "pnpm --filter @rakazo/linkbuilder-browser exec playwright install chromium";

export interface BrowserTestGate {
  available: boolean;
  /** Set when browser tests are skipped, so the skip reason shows up in the test output. */
  reason?: string;
  /** CI sets `LB_E2E_REQUIRE_BROWSER=1` so a missing Chromium fails instead of skipping. */
  required: boolean;
}

export function browserTestGate(env: NodeJS.ProcessEnv = process.env): BrowserTestGate {
  const required = env.LB_E2E_REQUIRE_BROWSER === "1";
  let path: string;
  try {
    path = chromium.executablePath();
  } catch {
    path = "";
  }
  if (path && existsSync(path)) return { available: true, required };
  return {
    available: false,
    required,
    reason: `Playwright Chromium is not installed; run \`${CHROMIUM_INSTALL_COMMAND}\``,
  };
}
