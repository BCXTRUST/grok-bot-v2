import type { BrowserSession, TokenCaptchaType } from "@rakazo/adapter-kit";
import type { CaptchaChallenge } from "./driver.js";

/** Widget containers by vendor; the site key sits in `data-sitekey` (plan section 7.2). */
const WIDGETS: ReadonlyArray<{ selector: string; type: TokenCaptchaType }> = [
  { selector: ".g-recaptcha", type: "recaptcha_v2" },
  { selector: ".cf-turnstile", type: "turnstile" },
  { selector: ".h-captcha", type: "hcaptcha" },
];

const RECAPTCHA_FRAME = "iframe[src*='recaptcha'][src*='k=']";

export async function detectWidget(session: BrowserSession): Promise<CaptchaChallenge> {
  for (const widget of WIDGETS) {
    if (!(await session.exists(widget.selector))) continue;
    const siteKey = await session.attribute(widget.selector, "data-sitekey");
    return { kind: "widget", type: widget.type, siteKey: siteKey?.trim() || null };
  }
  const frame = await session.attribute(RECAPTCHA_FRAME, "src");
  if (frame) {
    const siteKey = new URL(frame, "https://invalid.example").searchParams.get("k");
    return { kind: "widget", type: "recaptcha_v2", siteKey: siteKey || null };
  }
  return { kind: "none" };
}
