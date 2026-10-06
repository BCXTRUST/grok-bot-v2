import {
  isWithinWindow,
  localClock,
  type ScheduleReason,
  type ScheduleWindow,
} from "./schedule.js";

/**
 * Logged-out checks from plan 6.5: T+0 is two minutes after the post, then
 * one, three, seven and thirty days from that same anchor.
 */
export const VERIFY_OFFSETS_MS = [
  2 * 60_000,
  24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
  30 * 24 * 60 * 60_000,
] as const;

/** Renew a sticky lease this long before it expires. */
export const PROXY_RENEW_LEAD_MS = 10 * 60 * 1000;

/** Local hour at which the nightly discovery pass may run. */
export const DISCOVERY_HOUR = 3;

/** Backoff before webhook attempts 1, 2 and 3. Attempt 4 is not scheduled. */
export const WEBHOOK_BACKOFF_MS = [0, 60_000, 5 * 60_000] as const;

/** Deadline of the check at `completedChecks` (0 = the first, T+0). Null when the schedule is finished. */
export function verifyDeadline(anchor: Date, completedChecks: number): Date | null {
  const offset = VERIFY_OFFSETS_MS[completedChecks];
  if (offset === undefined) return null;
  return new Date(anchor.getTime() + offset);
}

export function placementVerifyDue(nextVerifyAt: Date | null, now: Date): boolean {
  return nextVerifyAt !== null && nextVerifyAt.getTime() <= now.getTime();
}

/**
 * First pass as soon as the project is active, then once per local day from 03:00.
 * The runner tick calls this; it does not decide the interval itself.
 */
export function discoveryDue(last: Date | null, now: Date, timeZone: string): boolean {
  if (!last) return true;
  try {
    if (localClock(last, timeZone).dateKey === localClock(now, timeZone).dateKey) return false;
    const hour = Math.floor(localClock(now, timeZone).minutes / 60);
    return hour >= DISCOVERY_HOUR;
  } catch {
    return now.getTime() - last.getTime() > 20 * 3_600_000;
  }
}

export function proxyRenewalDue(
  renewsAt: Date | null,
  now: Date,
  leadMs = PROXY_RENEW_LEAD_MS,
): boolean {
  if (!renewsAt) return false;
  return renewsAt.getTime() <= now.getTime() + leadMs;
}

/**
 * Captell balance is read once per runner tick, and only while the project is inside
 * its window or overtime. A later step in the same tick must not check again.
 */
export function balanceCheckDue(input: {
  scheduleActive: boolean;
  checkedThisTick: boolean;
}): boolean {
  return input.scheduleActive && !input.checkedThisTick;
}

export function shouldOpenDailyRun(active: boolean): boolean {
  return active;
}

/** Window-end report. Weekends and the time before the window do not write one. */
export function shouldWriteWhyNot(reason: ScheduleReason, alreadyWritten: boolean): boolean {
  if (alreadyWritten) return false;
  return reason === "after_window" || reason === "hard_stop" || reason === "live_met";
}

export function scheduleAt(now: Date, schedule: ScheduleWindow, liveMet: boolean) {
  return isWithinWindow(now, schedule, { liveMet });
}

export function ticketDue(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/** When the next delivery attempt may run. Null after the last attempt. */
export function webhookNextAttempt(completedAttempts: number, now: Date): Date | null {
  const delay = WEBHOOK_BACKOFF_MS[completedAttempts];
  if (delay === undefined) return null;
  return new Date(now.getTime() + delay);
}
