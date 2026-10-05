import { platformSuite } from "./platform-suite.js";
import { startWoltlabFixture } from "./testing/woltlab-fixture.js";
import { WoltlabDriver } from "./woltlab.js";

platformSuite({
  driver: new WoltlabDriver(),
  start: startWoltlabFixture,
  door: "widget",
  widgetType: "turnstile",
  permalink: /\/forum\/thread\/1-membership\/\?postID=\d+#post\d+$/,
});
