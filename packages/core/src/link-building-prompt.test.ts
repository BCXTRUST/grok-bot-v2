import { describe, expect, it } from "vitest";
import { LINK_BUILDING_BOT_INSTRUCTIONS } from "./link-building-prompt.js";

describe("link-building prompt", () => {
  it("keeps the bot on computer research without Google", () => {
    expect(LINK_BUILDING_BOT_INSTRUCTIONS).toMatch(/open_path/);
    expect(LINK_BUILDING_BOT_INSTRUCTIONS).toMatch(/Never Google Search/);
    expect(LINK_BUILDING_BOT_INSTRUCTIONS).toMatch(/assigned inbox/);
  });
});
