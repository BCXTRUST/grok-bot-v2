import { MybbDriver } from "./mybb.js";
import { platformSuite } from "./platform-suite.js";
import { startMybbFixture } from "./testing/mybb-fixture.js";

platformSuite({
  driver: new MybbDriver(),
  start: startMybbFixture,
  door: "image",
  permalink: /\/showthread\.php\?tid=1&pid=\d+#pid\d+$/,
});
