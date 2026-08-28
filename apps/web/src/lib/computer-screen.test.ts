import { describe, expect, it } from "vitest";
import { screenFrameSrc } from "./computer-screen.js";

describe("screenFrameSrc", () => {
  it("builds a data URL for a PNG frame", () => {
    expect(screenFrameSrc({ image: "abc", mimeType: "image/png" })).toBe(
      "data:image/png;base64,abc",
    );
  });

  it("returns null when there is no image", () => {
    expect(screenFrameSrc({ image: null })).toBeNull();
    expect(screenFrameSrc({})).toBeNull();
  });
});
