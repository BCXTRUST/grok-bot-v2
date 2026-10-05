import { discourseBoard } from "../discourse.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startDiscourseFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(discourseBoard, options);
}
