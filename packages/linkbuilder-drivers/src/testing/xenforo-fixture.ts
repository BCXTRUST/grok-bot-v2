import { xenforoBoard } from "../xenforo.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startXenforoFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(xenforoBoard, options);
}
