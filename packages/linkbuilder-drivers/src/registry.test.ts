import type { LbHostPlatform } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { DiscourseDriver } from "./discourse.js";
import { FlarumDriver } from "./flarum.js";
import { GenericFormDriver } from "./generic.js";
import { boardDriverFor, supportedPlatforms } from "./index.js";
import { IpsDriver } from "./ips.js";
import { MybbDriver } from "./mybb.js";
import { NodebbDriver } from "./nodebb.js";
import { PhpbbDriver } from "./phpbb.js";
import { VanillaDriver } from "./vanilla.js";
import { VbulletinDriver } from "./vbulletin.js";
import { WoltlabDriver } from "./woltlab.js";
import { XenforoDriver } from "./xenforo.js";

const expected: Array<[LbHostPlatform, { new (): unknown }]> = [
  ["phpbb", PhpbbDriver],
  ["woltlab", WoltlabDriver],
  ["xenforo", XenforoDriver],
  ["ips", IpsDriver],
  ["vbulletin", VbulletinDriver],
  ["mybb", MybbDriver],
  ["discourse", DiscourseDriver],
  ["flarum", FlarumDriver],
  ["nodebb", NodebbDriver],
  ["vanilla", VanillaDriver],
  ["unknown", GenericFormDriver],
];

describe("board driver registry", () => {
  it("returns a driver for every platform and the generic fallback", () => {
    expect(supportedPlatforms()).toEqual(expected.map(([platform]) => platform));
    for (const [platform, ctor] of expected) {
      expect(boardDriverFor(platform)).toBeInstanceOf(ctor);
    }
    expect(boardDriverFor("qa_other")).toBeNull();
  });
});
