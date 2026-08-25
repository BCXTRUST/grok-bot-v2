import { describe, expect, it } from "vitest";
import { embeddableScreenUrl } from "./screen-url.js";

describe("embeddableScreenUrl", () => {
  it("rewrites proxied noVNC URLs onto the current page so a tunnel host can iframe them", () => {
    expect(
      embeddableScreenUrl(
        "http://127.0.0.1:5173/novnc/remote/view/1.token/vnc.html?view_only=true",
        "https://assembled-fraction-kid-pressing.trycloudflare.com/app",
      ),
    ).toBe("/novnc/remote/view/1.token/vnc.html?view_only=true");
  });

  it("keeps same-origin loopback screens as a same-page path", () => {
    expect(
      embeddableScreenUrl(
        "http://127.0.0.1:5173/novnc/abc/16080/view/1.sig/embed.html",
        "http://127.0.0.1:5173/app",
      ),
    ).toBe("/novnc/abc/16080/view/1.sig/embed.html");
  });

  it("hides loopback screens that are not the current page origin", () => {
    expect(
      embeddableScreenUrl(
        "http://127.0.0.1:16080/embed.html",
        "https://assembled-fraction-kid-pressing.trycloudflare.com/app",
      ),
    ).toBeNull();
  });
});
