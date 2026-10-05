import { describe, expect, it } from "vitest";
import { DISCOURSE_MIN_POSTS_BEFORE_LINK, DiscourseDriver } from "./discourse.js";
import { platformSuite } from "./platform-suite.js";
import { startDiscourseFixture } from "./testing/discourse-fixture.js";

const driver = new DiscourseDriver();

platformSuite({
  driver,
  start: startDiscourseFixture,
  door: "widget",
  widgetType: "hcaptcha",
  permalink: /\/t\/membership\/1\/\d+$/,
  jsonPath: "/t/membership/1.json",
});

describe("Discourse trust level", () => {
  it("forces a link-free post because TL0 cannot post links", () => {
    expect(driver.minPostsBeforeLink).toBe(DISCOURSE_MIN_POSTS_BEFORE_LINK);
    expect(driver.minPostsBeforeLink).toBeGreaterThanOrEqual(1);
    expect(driver.allowEmoji).toBe(true);
    expect(driver.nofollowDefault).toBe(true);
  });
});
