import { ipsBoard } from "../ips.js";
import {
  type MarkupFixture,
  type MarkupFixtureOptions,
  startMarkupFixture,
} from "./board-fixture.js";

export function startIpsFixture(options: MarkupFixtureOptions): Promise<MarkupFixture> {
  return startMarkupFixture(ipsBoard, options);
}
