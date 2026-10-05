import { woltlabBoard } from "../woltlab.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startWoltlabFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(woltlabBoard, options);
}
