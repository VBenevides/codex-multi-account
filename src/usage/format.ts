const UNITS = [
  ["T", 1_000_000_000_000n, 2],
  ["B", 1_000_000_000n, 2],
  ["M", 1_000_000n, 1],
  ["K", 1_000n, 1],
] as const;

export function formatTokenCount(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  if (absolute < 1_000n) return `${sign}${absolute}`;

  for (const [suffix, divisor, maxPrecision] of UNITS) {
    if (absolute < divisor) continue;
    const whole = absolute / divisor;
    const precision = maxPrecision > 1 || whole < 100n ? maxPrecision : 0;
    const scale = 10n ** BigInt(precision);
    const scaled = (absolute * scale) / divisor;
    const displayWhole = scaled / scale;
    const fraction = scaled % scale;
    const decimal = fraction.toString().padStart(precision, "0");
    const showDecimal = precision > 1 || fraction !== 0n;
    return `${sign}${displayWhole}${showDecimal ? `.${decimal}` : ""}${suffix}`;
  }
  return `${sign}${absolute}`;
}

export function formatCachingRate(cached: bigint, input: bigint): string {
  if (input <= 0n || cached <= 0n) return "0%";
  const boundedCached = cached > input ? input : cached;
  const tenths = (boundedCached * 1000n) / input;
  const decimal = tenths % 10n;
  return `${tenths / 10n}${decimal ? `.${decimal}` : ""}%`;
}

export function formatDateTime(value: string | Date, locale?: string): string {
  const date = toDate(value);
  if (!date) return "Unavailable";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value: string | Date, now = new Date()): string {
  const date = toDate(value);
  if (!date || Number.isNaN(now.getTime())) return "Unavailable";
  const difference = date.getTime() - now.getTime();
  const absolute = Math.abs(difference);
  if (absolute < 60_000) return "just now";

  const minutes = Math.floor(absolute / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainingMinutes = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && !hours && remainingMinutes) parts.push(`${remainingMinutes}m`);
  const text = parts.join(" ") || "just now";
  return difference > 0 ? `in ${text}` : `${text} ago`;
}

function toDate(value: string | Date): Date | undefined {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
