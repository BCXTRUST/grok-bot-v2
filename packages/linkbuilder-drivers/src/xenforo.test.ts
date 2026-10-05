import { platformSuite } from "./platform-suite.js";
import { startXenforoFixture } from "./testing/xenforo-fixture.js";
import { XenforoDriver } from "./xenforo.js";

platformSuite({
  driver: new XenforoDriver(),
  start: startXenforoFixture,
  door: "widget",
  widgetType: "recaptcha_v2",
  permalink: /\/threads\/membership\.1\/post-\d+$/,
});
