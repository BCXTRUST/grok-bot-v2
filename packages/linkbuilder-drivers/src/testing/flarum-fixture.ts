import { flarumBoard } from "../flarum.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startFlarumFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(flarumBoard, options);
}
