import { FlarumDriver } from "./flarum.js";
import { platformSuite } from "./platform-suite.js";
import { startFlarumFixture } from "./testing/flarum-fixture.js";

platformSuite({
  driver: new FlarumDriver(),
  start: startFlarumFixture,
  door: "none",
  permalink: /\/d\/1-membership\/\d+$/,
});
