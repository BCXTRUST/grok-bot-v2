import { platformSuite } from "./platform-suite.js";
import { startVanillaFixture } from "./testing/vanilla-fixture.js";
import { VanillaDriver } from "./vanilla.js";

platformSuite({
  driver: new VanillaDriver(),
  start: startVanillaFixture,
  door: "widget",
  widgetType: "recaptcha_v2",
  permalink: /\/discussion\/comment\/\d+#Comment_\d+$/,
});
