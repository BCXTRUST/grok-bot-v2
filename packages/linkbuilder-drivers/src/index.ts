import type { LbHostPlatform } from "@rakazo/contracts";
import type { BoardDriver } from "./driver.js";
import { PhpbbDriver } from "./phpbb.js";

export * from "./captcha.js";
export * from "./cookie-wall.js";
export * from "./driver.js";
export * from "./phpbb.js";
export * from "./verify.js";
export * from "./widgets.js";

const DRIVERS: Partial<Record<LbHostPlatform, BoardDriver>> = {
  phpbb: new PhpbbDriver(),
};

/** The driver for a platform, or null while that platform has no driver yet. */
export function boardDriverFor(platform: LbHostPlatform): BoardDriver | null {
  return DRIVERS[platform] ?? null;
}

export function supportedPlatforms(): LbHostPlatform[] {
  return Object.keys(DRIVERS) as LbHostPlatform[];
}
