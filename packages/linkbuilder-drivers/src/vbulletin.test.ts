import { describe, expect, it } from "vitest";
import { platformSuite } from "./platform-suite.js";
import { startVbulletinFixture } from "./testing/vbulletin-fixture.js";
import { VbulletinDriver, vbulletinPermalink } from "./vbulletin.js";

platformSuite({
  driver: new VbulletinDriver(),
  start: startVbulletinFixture,
  door: "image",
  permalink: /\/showthread\.php\?p=\d+#post\d+$/,
});

describe("vBulletin pretty permalink", () => {
  it("keeps /threads/<id>-slug when that is the path", () => {
    expect(vbulletinPermalink("http://board.example/threads/4-club?p=9#post9")).toBe(
      "http://board.example/threads/4-club?p=9#post9",
    );
  });
});
