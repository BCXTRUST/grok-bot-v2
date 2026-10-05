import { describe, expect, it } from "vitest";
import { NodebbDriver, nodebbPermalink } from "./nodebb.js";
import { platformSuite } from "./platform-suite.js";
import { startNodebbFixture } from "./testing/nodebb-fixture.js";

platformSuite({
  driver: new NodebbDriver(),
  start: startNodebbFixture,
  door: "widget",
  widgetType: "hcaptcha",
  permalink: /\/post\/\d+$/,
});

describe("NodeBB topic permalink", () => {
  it("keeps /topic/<id>/slug/<index> when there is no post id", () => {
    expect(nodebbPermalink("http://board.example/topic/3/club/2")).toBe(
      "http://board.example/topic/3/club/2",
    );
  });
});
