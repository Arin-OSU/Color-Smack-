// Hard rule: no em dashes in UI copy, work orders, explanations, or anywhere.
// Always run every Claude-generated string through stripEmDashes before rendering.
export function stripEmDashes(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\u2014/g, " - ") // em dash
    .replace(/\u2013/g, " - ") // en dash
    .replace(/\s-\s-\s/g, " - ");
}

export function formatCurrency(n: number, opts?: { withEst?: boolean }): string {
  const withEst = opts?.withEst ?? true;
  const rounded = n >= 1000 ? Math.round(n) : Math.round(n * 100) / 100;
  const out = rounded.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
  return withEst ? `${out} est.` : out;
}

export function formatPercentile(p: number, decimals = 1): string {
  const n = Math.max(0, Math.min(1, p));
  return `p${(n * 100).toFixed(decimals)}`;
}

export function humanizeDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)} hr`;
  const days = hours / 24;
  return `${days.toFixed(days >= 10 ? 0 : 1)} days`;
}

export function humanizeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const f = (d: Date) =>
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  if (sameDay) {
    return `${f(start)} - ${end.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`;
  }
  return `${f(start)} - ${f(end)}`;
}
