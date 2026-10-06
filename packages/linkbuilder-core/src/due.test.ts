import { describe, expect, it } from "vitest";
import {
  balanceCheckDue,
  discoveryDue,
  placementVerifyDue,
  proxyRenewalDue,
  scheduleAt,
  shouldWriteWhyNot,
  ticketDue,
  VERIFY_OFFSETS_MS,
  verifyDeadline,
  webhookNextAttempt,
} from "./due.js";

const schedule = {
  timezone: "Europe/Berlin",
  weekdaysOnly: true,
  window: { start: "09:00", end: "17:00" },
  overtimeUntilLiveMet: true,
  hardStopHour: 20,
};

describe("due schedules", () => {
  it("spaces re-verification at T+0, +1d, +3d, +7d and +30d", () => {
    const anchor = new Date("2026-10-05T07:00:00.000Z");
    expect(verifyDeadline(anchor, 0)?.getTime()).toBe(anchor.getTime() + VERIFY_OFFSETS_MS[0]);
    expect(verifyDeadline(anchor, 1)?.getTime()).toBe(anchor.getTime() + 86_400_000);
    expect(verifyDeadline(anchor, 2)?.getTime()).toBe(anchor.getTime() + 3 * 86_400_000);
    expect(verifyDeadline(anchor, 3)?.getTime()).toBe(anchor.getTime() + 7 * 86_400_000);
    expect(verifyDeadline(anchor, 4)?.getTime()).toBe(anchor.getTime() + 30 * 86_400_000);
    expect(verifyDeadline(anchor, 5)).toBeNull();
    expect(placementVerifyDue(verifyDeadline(anchor, 0), new Date(anchor.getTime() + 60_000))).toBe(
      false,
    );
    expect(
      placementVerifyDue(verifyDeadline(anchor, 0), new Date(anchor.getTime() + 120_000)),
    ).toBe(true);
  });

  it("discovers immediately, then once per local day from 03:00", () => {
    const monday = new Date("2026-10-05T01:00:00.000Z");
    expect(discoveryDue(null, monday, "Europe/Berlin")).toBe(true);
    expect(discoveryDue(monday, new Date("2026-10-05T20:00:00.000Z"), "Europe/Berlin")).toBe(false);
    expect(discoveryDue(monday, new Date("2026-10-06T00:30:00.000Z"), "Europe/Berlin")).toBe(false);
    expect(discoveryDue(monday, new Date("2026-10-06T01:00:00.000Z"), "Europe/Berlin")).toBe(true);
  });

  it("renews a proxy inside the lead and checks balance once per tick", () => {
    const now = new Date("2026-10-05T10:00:00.000Z");
    expect(proxyRenewalDue(new Date(now.getTime() + 5 * 60_000), now)).toBe(true);
    expect(proxyRenewalDue(new Date(now.getTime() + 30 * 60_000), now)).toBe(false);
    expect(proxyRenewalDue(null, now)).toBe(false);
    expect(balanceCheckDue({ scheduleActive: true, checkedThisTick: false })).toBe(true);
    expect(balanceCheckDue({ scheduleActive: true, checkedThisTick: true })).toBe(false);
    expect(balanceCheckDue({ scheduleActive: false, checkedThisTick: false })).toBe(false);
  });

  it("opens weekdays inside the window, overtime until the hard stop, and writes whyNot at the end", () => {
    const open = new Date("2026-10-05T08:00:00.000Z");
    expect(scheduleAt(open, schedule, false)).toMatchObject({ active: true, mode: "window" });
    const after = new Date("2026-10-05T16:00:00.000Z");
    expect(scheduleAt(after, schedule, false)).toMatchObject({
      mode: "overtime",
      reason: "overtime",
    });
    expect(scheduleAt(after, schedule, true)).toMatchObject({ reason: "live_met" });
    const stopped = new Date("2026-10-05T18:30:00.000Z");
    expect(scheduleAt(stopped, schedule, false).reason).toBe("hard_stop");
    const saturday = new Date("2026-10-10T08:00:00.000Z");
    expect(scheduleAt(saturday, schedule, false).reason).toBe("weekend");
    expect(shouldWriteWhyNot("after_window", false)).toBe(true);
    expect(shouldWriteWhyNot("hard_stop", false)).toBe(true);
    expect(shouldWriteWhyNot("weekend", false)).toBe(false);
    expect(shouldWriteWhyNot("after_window", true)).toBe(false);
  });

  it("expires tickets and backs off webhook attempts", () => {
    const now = new Date("2026-10-06T08:00:00.000Z");
    expect(ticketDue(new Date(now.getTime() - 1), now)).toBe(true);
    expect(ticketDue(new Date(now.getTime() + 1), now)).toBe(false);
    expect(webhookNextAttempt(0, now)?.getTime()).toBe(now.getTime());
    expect(webhookNextAttempt(1, now)?.getTime()).toBe(now.getTime() + 60_000);
    expect(webhookNextAttempt(3, now)).toBeNull();
  });
});
