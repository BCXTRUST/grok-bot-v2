export interface ScheduleWindow {
  timezone: string;
  weekdaysOnly: boolean;
  window: { start: string; end: string };
  overtimeUntilLiveMet: boolean;
  /** Local hour (exclusive) at which overtime stops; 24 means midnight. */
  hardStopHour: number;
}

export type ScheduleMode = "window" | "overtime" | "closed";

export type ScheduleReason =
  | "in_window"
  | "overtime"
  | "weekend"
  | "before_window"
  | "after_window"
  | "live_met"
  | "hard_stop";

export interface ScheduleState {
  active: boolean;
  mode: ScheduleMode;
  reason: ScheduleReason;
}

export interface LocalClock {
  dateKey: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function parseClockTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new RangeError(`Expected HH:MM, got ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function localClock(now: Date, timeZone: string): LocalClock {
  if (Number.isNaN(now.getTime())) throw new RangeError("Invalid date");
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(now)) parts[part.type] = part.value;
  const isoWeekday = WEEKDAYS[parts.weekday ?? ""];
  if (!isoWeekday) throw new RangeError(`Unexpected weekday ${parts.weekday}`);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    isoWeekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Local calendar date (`YYYY-MM-DD`) used as the per-project run key. */
export function localDateKey(now: Date, timeZone: string): string {
  return localClock(now, timeZone).dateKey;
}

export function isWithinWindow(
  now: Date,
  schedule: ScheduleWindow,
  progress: { liveMet: boolean },
): ScheduleState {
  const start = parseClockTime(schedule.window.start);
  const end = parseClockTime(schedule.window.end);
  if (start >= end) throw new RangeError("Window must start before it ends on the same day");
  const clock = localClock(now, schedule.timezone);
  if (schedule.weekdaysOnly && clock.isoWeekday >= 6) {
    return { active: false, mode: "closed", reason: "weekend" };
  }
  if (clock.minutes < start) return { active: false, mode: "closed", reason: "before_window" };
  if (clock.minutes < end) return { active: true, mode: "window", reason: "in_window" };
  if (!schedule.overtimeUntilLiveMet) {
    return { active: false, mode: "closed", reason: "after_window" };
  }
  if (progress.liveMet) return { active: false, mode: "closed", reason: "live_met" };
  if (clock.minutes >= schedule.hardStopHour * 60) {
    return { active: false, mode: "closed", reason: "hard_stop" };
  }
  return { active: true, mode: "overtime", reason: "overtime" };
}
