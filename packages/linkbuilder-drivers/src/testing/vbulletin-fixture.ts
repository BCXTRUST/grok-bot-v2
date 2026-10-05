import { vbulletinBoard } from "../vbulletin.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startVbulletinFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(vbulletinBoard, options);
}
