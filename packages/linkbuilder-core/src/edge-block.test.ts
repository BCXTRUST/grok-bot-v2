import { describe, expect, it } from "vitest";
import { decideEdgeBlock, isHardEdgeBlock } from "./edge-block.js";

describe("edge block", () => {
  it("detects a challenge page, a Just a moment title, and a 403 with cf-ray", () => {
    expect(isHardEdgeBlock({ body: "<div class='cf-chl-bypass'>", title: "x" })).toBe(true);
    expect(isHardEdgeBlock({ title: "Just a moment...", body: "" })).toBe(true);
    expect(isHardEdgeBlock({ status: 403, headers: { "CF-Ray": "abc" }, body: "" })).toBe(true);
    expect(isHardEdgeBlock({ status: 403, body: "forbidden" })).toBe(false);
    expect(isHardEdgeBlock({ status: 200, body: "Willkommen" })).toBe(false);
  });

  it("records the first Chromium block, retries Camoufox on the second, then stops", () => {
    expect(
      decideEdgeBlock({
        engineHint: null,
        priorChromiumBlocks: 0,
        blockedNow: true,
        camoufoxAvailable: true,
      }),
    ).toEqual({ action: "record" });
    expect(
      decideEdgeBlock({
        engineHint: null,
        priorChromiumBlocks: 1,
        blockedNow: true,
        camoufoxAvailable: true,
      }),
    ).toEqual({ action: "retry_camoufox" });
    expect(
      decideEdgeBlock({
        engineHint: "camoufox",
        priorChromiumBlocks: 1,
        blockedNow: true,
        camoufoxAvailable: true,
      }),
    ).toEqual({ action: "dead", reason: "edge_block" });
  });

  it("marks the host dead when Camoufox is not installed", () => {
    expect(
      decideEdgeBlock({
        engineHint: null,
        priorChromiumBlocks: 1,
        blockedNow: true,
        camoufoxAvailable: false,
      }),
    ).toEqual({ action: "dead", reason: "edge_block" });
  });

  it("leaves a clean page on the current engine", () => {
    expect(
      decideEdgeBlock({
        engineHint: null,
        priorChromiumBlocks: 0,
        blockedNow: false,
        camoufoxAvailable: false,
      }),
    ).toEqual({ action: "continue" });
  });
});
