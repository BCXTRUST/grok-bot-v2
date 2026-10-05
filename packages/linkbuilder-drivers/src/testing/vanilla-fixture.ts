import { vanillaBoard } from "../vanilla.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startVanillaFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(vanillaBoard, options);
}
