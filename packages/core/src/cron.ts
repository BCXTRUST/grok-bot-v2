const WEEKDAYS = "1-5";

export function cronFromPreset(input: {
  freq: string;
  n?: number;
  unit?: string;
  time?: string;
  cron?: string;
}): string {
  if (input.freq === "Advanced" && input.cron) return input.cron;
  if (input.freq === "Every hour") return "0 * * * *";
  if (input.freq === "Interval") {
    const n = input.n ?? 5;
    if (input.unit === "hours") return `0 */${n} * * *`;
    return `*/${n} * * * *`;
  }
  const [rawH, rest] = (input.time ?? "9:00 AM").split(":");
  const minute = Number((rest ?? "00").slice(0, 2));
  let hour = Number(rawH);
  if (/pm/i.test(input.time ?? "") && hour < 12) hour += 12;
  if (/am/i.test(input.time ?? "") && hour === 12) hour = 0;
  if (input.freq === "Weekdays") return `${minute} ${hour} * * ${WEEKDAYS}`;
  if (input.freq === "Every week") return `${minute} ${hour} * * 1`;
  if (input.freq === "Every month") return `${minute} ${hour} 1 * *`;
  return `${minute} ${hour} * * *`;
}

export function nextCronDate(cron: string, from: Date, timezone = "UTC"): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return new Date(from.getTime() + 60_000);
  }
  const [minuteExpr, hourExpr] = parts;
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 24 * 60 + 2; i += 1) {
    const minute = candidate.getUTCMinutes();
    const hour = candidate.getUTCHours();
    if (matchField(minuteExpr ?? "*", minute, 0, 59) && matchField(hourExpr ?? "*", hour, 0, 23)) {
      void timezone;
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return new Date(from.getTime() + 60_000);
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  if (expr === "*") return true;
  if (expr.startsWith("*/")) {
    const step = Number(expr.slice(2));
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  if (expr.includes("-")) {
    const [a, b] = expr.split("-").map(Number);
    return value >= (a ?? min) && value <= (b ?? max);
  }
  if (expr.includes(",")) {
    return expr.split(",").map(Number).includes(value);
  }
  return Number(expr) === value;
}
