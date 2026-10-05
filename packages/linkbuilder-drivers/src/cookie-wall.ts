import type { BrowserSession } from "@rakazo/adapter-kit";

/**
 * Accept buttons of common consent managers and board cookie notices, most specific first.
 * Only "accept necessary"/"accept" style buttons; never settings or reject dialogs that open more UI.
 */
export const COOKIE_ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "button.fc-cta-consent",
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "#didomi-notice-agree-button",
  ".cmplz-btn.cmplz-accept",
  ".cc-window .cc-allow",
  ".cc-window .cc-dismiss",
  "[data-cookie-accept]",
  "#cookie-consent button.accept",
  ".cookie-notice .button.accept",
] as const;

export type CookieWallResult = "accepted" | "none";

export async function acceptCookieWall(
  session: BrowserSession,
  selectors: readonly string[] = COOKIE_ACCEPT_SELECTORS,
): Promise<CookieWallResult> {
  for (const selector of selectors) {
    if (!(await session.exists(selector))) continue;
    await session.click(selector);
    return "accepted";
  }
  return "none";
}
