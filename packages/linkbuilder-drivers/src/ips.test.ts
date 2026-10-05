import { IpsDriver } from "./ips.js";
import { platformSuite } from "./platform-suite.js";
import { startIpsFixture } from "./testing/ips-fixture.js";

platformSuite({
  driver: new IpsDriver(),
  start: startIpsFixture,
  door: "widget",
  widgetType: "turnstile",
  permalink: /\/topic\/1-membership\/#comment-\d+$/,
});
