export const DAY = 86_400_000;
export const dateAfter = (days: number, from = new Date()) => {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};
export const dayKey = (date: Date | string) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const daysUntil = (date: string, now = new Date()) => {
  const target = new Date(date);
  return Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      DAY,
  );
};
export const formatDate = (
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) => new Date(date).toLocaleDateString("en-US", options);
export const formatTime = (date: string | Date) =>
  new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
export function countdown(date: string, now = new Date()) {
  const minutes = Math.floor(
    (new Date(date).getTime() - now.getTime()) / 60_000,
  );
  if (minutes < 0)
    return `${Math.abs(Math.ceil(minutes / 1440)) || 1}d overdue`;
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 1440)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  return `${Math.ceil(minutes / 1440)} days left`;
}
export function atTime(day: number, hour: number, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
