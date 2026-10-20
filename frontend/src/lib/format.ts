const MINUS = "−";

const pad = (value: number) => String(value).padStart(2, "0");

/** 2D 06:12:33 · 06:12:33 · −03:12:10 */
export function countdown(ms: number): string {
  const sign = ms < 0 ? MINUS : "";
  let seconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const clock = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return `${sign}${days ? `${days}D ` : ""}${clock}`;
}

/** 45m · 1h 05m */
export function minutes(total: number): string {
  const rounded = Math.round(total);
  if (Math.abs(rounded) < 60) return `${rounded}m`;
  const hours = Math.trunc(rounded / 60);
  return `${hours}h ${pad(Math.abs(rounded % 60))}m`;
}

export const pct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

/** +4.2 · −2.4 with a true minus sign. */
export function signed(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return `±${fixed}`;
  return `${value > 0 ? "+" : MINUS}${fixed}`;
}

/** Scores span 0.01 to several thousand; keep about three significant digits. */
export const score = (value: number) =>
  value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);

export function clock(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" })
    .format(new Date(iso))
    .toUpperCase();
}

export function stamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .toUpperCase();
}
