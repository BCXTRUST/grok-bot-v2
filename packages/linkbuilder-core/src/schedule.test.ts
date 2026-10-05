import { describe, expect, it } from "vitest";
import {
  isWithinWindow,
  localClock,
  localDateKey,
  parseClockTime,
  type ScheduleWindow,
} from "./schedule.js";

const berlin: ScheduleWindow = {
  timezone: "Europe/Berlin",
  weekdaysOnly: true,
  window: { start: "09:00", end: "22:00" },
  overtimeUntilLiveMet: false,
  hardStopHour: 24,
};

const at = (iso: string) => new Date(iso);

describe("parseClockTime", () => {
  it.each([
    ["00:00", 0],
    ["09:00", 540],
    ["23:59", 1439],
  ])("parses %s", (value, minutes) => {
    expect(parseClockTime(value)).toBe(minutes);
  });

  it.each(["24:00", "9:00", "12:60", "", "12:00:00"])("rejects %j", (value) => {
    expect(() => parseClockTime(value)).toThrow(RangeError);
  });
});

describe("localClock", () => {
  it("reads the local date, ISO weekday and minutes", () => {
    expect(localClock(at("2026-10-05T07:00:00Z"), "Europe/Berlin")).toEqual({
      dateKey: "2026-10-05",
      isoWeekday: 1,
      minutes: 9 * 60,
    });
    expect(localClock(at("2026-10-11T10:00:00Z"), "Europe/Berlin").isoWeekday).toBe(7);
  });

  it("follows the spring-forward switch in Europe/Berlin (2026-03-29)", () => {
    expect(localClock(at("2026-03-29T00:59:00Z"), "Europe/Berlin").minutes).toBe(1 * 60 + 59);
    expect(localClock(at("2026-03-29T01:00:00Z"), "Europe/Berlin").minutes).toBe(3 * 60);
    expect(localClock(at("2026-03-27T08:00:00Z"), "Europe/Berlin").minutes).toBe(9 * 60);
    expect(localClock(at("2026-03-30T07:00:00Z"), "Europe/Berlin").minutes).toBe(9 * 60);
  });

  it("follows the fall-back switch in Europe/Berlin (2026-10-25)", () => {
    const first = localClock(at("2026-10-25T00:30:00Z"), "Europe/Berlin");
    const repeated = localClock(at("2026-10-25T01:30:00Z"), "Europe/Berlin");
    expect(first).toEqual(repeated);
    expect(first).toEqual({ dateKey: "2026-10-25", isoWeekday: 7, minutes: 2 * 60 + 30 });
    expect(localClock(at("2026-10-26T08:00:00Z"), "Europe/Berlin").minutes).toBe(9 * 60);
  });

  it("handles market time zones worldwide, including non-hour offsets", () => {
    expect(localClock(at("2026-10-05T13:00:00Z"), "America/New_York").minutes).toBe(9 * 60);
    expect(localClock(at("2026-10-05T12:00:00Z"), "America/Sao_Paulo").minutes).toBe(9 * 60);
    expect(localClock(at("2026-10-05T03:30:00Z"), "Asia/Kolkata").minutes).toBe(9 * 60);
    expect(localClock(at("2026-10-04T19:15:00Z"), "Pacific/Chatham")).toMatchObject({
      dateKey: "2026-10-05",
      minutes: 9 * 60,
    });
  });

  it("rejects invalid dates and unknown zones", () => {
    expect(() => localClock(new Date(Number.NaN), "Europe/Berlin")).toThrow(RangeError);
    expect(() => localClock(at("2026-10-05T07:00:00Z"), "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("localDateKey", () => {
  it("keys runs by the project's local date around midnight", () => {
    expect(localDateKey(at("2026-10-05T21:59:00Z"), "Europe/Berlin")).toBe("2026-10-05");
    expect(localDateKey(at("2026-10-05T22:00:00Z"), "Europe/Berlin")).toBe("2026-10-06");
    expect(localDateKey(at("2026-10-06T03:59:00Z"), "America/New_York")).toBe("2026-10-05");
    expect(localDateKey(at("2026-10-06T04:00:00Z"), "America/New_York")).toBe("2026-10-06");
    expect(localDateKey(at("2026-12-31T23:30:00Z"), "Europe/Berlin")).toBe("2027-01-01");
  });
});

describe("isWithinWindow", () => {
  const notMet = { liveMet: false };

  it.each([
    ["2026-10-05T06:59:00Z", "before_window", false, "closed"],
    ["2026-10-05T07:00:00Z", "in_window", true, "window"],
    ["2026-10-05T19:59:00Z", "in_window", true, "window"],
    ["2026-10-05T20:00:00Z", "after_window", false, "closed"],
    ["2026-10-10T10:00:00Z", "weekend", false, "closed"],
    ["2026-10-11T10:00:00Z", "weekend", false, "closed"],
  ] as const)("%s → %s", (iso, reason, active, mode) => {
    expect(isWithinWindow(at(iso), berlin, notMet)).toEqual({ active, mode, reason });
  });

  it("opens at 09:00 local on both sides of the DST switches", () => {
    expect(isWithinWindow(at("2026-03-27T08:00:00Z"), berlin, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-03-27T07:59:00Z"), berlin, notMet).reason).toBe("before_window");
    expect(isWithinWindow(at("2026-03-30T07:00:00Z"), berlin, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-03-30T06:59:00Z"), berlin, notMet).reason).toBe("before_window");
    expect(isWithinWindow(at("2026-10-23T07:00:00Z"), berlin, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-10-26T08:00:00Z"), berlin, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-10-26T07:59:00Z"), berlin, notMet).reason).toBe("before_window");
  });

  it("works on DST Sundays when weekends are allowed", () => {
    const everyDay = { ...berlin, weekdaysOnly: false };
    expect(isWithinWindow(at("2026-03-29T07:00:00Z"), everyDay, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-03-29T06:59:00Z"), everyDay, notMet).reason).toBe(
      "before_window",
    );
    expect(isWithinWindow(at("2026-10-25T08:00:00Z"), everyDay, notMet).reason).toBe("in_window");
    expect(isWithinWindow(at("2026-10-25T07:59:00Z"), everyDay, notMet).reason).toBe(
      "before_window",
    );
  });

  it("runs overtime until LIVE is met or the hard stop", () => {
    const overtime = { ...berlin, overtimeUntilLiveMet: true, hardStopHour: 23 };
    expect(isWithinWindow(at("2026-10-05T20:30:00Z"), overtime, notMet)).toEqual({
      active: true,
      mode: "overtime",
      reason: "overtime",
    });
    expect(isWithinWindow(at("2026-10-05T20:30:00Z"), overtime, { liveMet: true })).toEqual({
      active: false,
      mode: "closed",
      reason: "live_met",
    });
    expect(isWithinWindow(at("2026-10-05T21:00:00Z"), overtime, notMet)).toEqual({
      active: false,
      mode: "closed",
      reason: "hard_stop",
    });
    const midnight = { ...overtime, hardStopHour: 24 };
    expect(isWithinWindow(at("2026-10-05T21:59:00Z"), midnight, notMet).reason).toBe("overtime");
  });

  it("keeps the regular window open even when LIVE is already met", () => {
    expect(isWithinWindow(at("2026-10-05T10:00:00Z"), berlin, { liveMet: true }).reason).toBe(
      "in_window",
    );
  });

  it("rejects windows that do not start before they end", () => {
    expect(() =>
      isWithinWindow(
        at("2026-10-05T10:00:00Z"),
        { ...berlin, window: { start: "22:00", end: "09:00" } },
        notMet,
      ),
    ).toThrow(RangeError);
  });
});
