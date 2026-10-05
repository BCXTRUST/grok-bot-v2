import { describe, expect, it } from "vitest";
import { verifyPlacement } from "./verify.js";

describe("logged-out verification", () => {
  it("never sends the persona proxy", async () => {
    const seen: Array<RequestInit | undefined> = [];
    const result = await verifyPlacement({
      postUrl: "http://127.0.0.1/viewtopic.php?p=1#p1",
      targetUrl: "https://nordlicht.example/guide",
      allowPrivateNetwork: true,
      fetchImpl: async (_url, init) => {
        seen.push(init);
        const html =
          '<html><body><div id="p1"><a href="https://nordlicht.example/guide">guide</a></div></body></html>';
        return new Response(html, { status: 200 });
      },
    });
    expect(result.outcome.status).toBe("live");
    expect(seen.length).toBeGreaterThan(0);
    const text = JSON.stringify(seen);
    expect(text).not.toMatch(/dispatcher|proxy|Proxy-Authorization|proxy\.example/i);
    expect(seen.every((init) => init?.dispatcher === undefined)).toBe(true);
  });
});
