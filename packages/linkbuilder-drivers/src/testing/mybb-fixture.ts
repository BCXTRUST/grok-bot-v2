import { mybbBoard } from "../mybb.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startMybbFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(mybbBoard, options);
}
