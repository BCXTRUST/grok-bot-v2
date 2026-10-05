import { nodebbBoard } from "../nodebb.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startNodebbFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(nodebbBoard, options);
}
