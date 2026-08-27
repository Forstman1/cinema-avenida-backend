const CINEMA_TIMEZONE = process.env.CINEMA_TIMEZONE || "Africa/Casablanca";

const cinemaDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CINEMA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface CinemaDateTimeParts {
  date: string;
  time: string;
}

function formatParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    cinemaDateTimeFormatter
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );
}

/** The database stores Screening.date as a calendar date at UTC midnight. */
export function getStoredCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the current instant represented in the cinema's local timezone. */
export function getCinemaDateTime(date: Date): CinemaDateTimeParts {
  const parts = formatParts(date);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

export function isValidDateKey(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function dateKeyToDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getStartOfCinemaWeek(date: Date): Date {
  const monday = dateKeyToDate(getCinemaDateTime(date).date);
  const weekday = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return monday;
}

function getTimezoneOffsetMs(date: Date): number {
  const parts = formatParts(date);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - date.getTime();
}

/**
 * Converts a cinema-local calendar date and HH:MM wall-clock time to an instant.
 * The small iteration handles timezone offset changes around DST transitions.
 */
export function cinemaDateTimeToDate(dateKey: string, showTime: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = showTime.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let result = wallClockAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = wallClockAsUtc - getTimezoneOffsetMs(new Date(result));
  }

  return new Date(result);
}

export function getScreeningDateTime(date: Date, showTime: string): Date {
  return cinemaDateTimeToDate(getStoredCalendarDate(date), showTime);
}

export function isScreeningInFuture(
  screening: { date: Date; showTime: string },
  now = new Date()
): boolean {
  return getScreeningDateTime(screening.date, screening.showTime).getTime() > now.getTime();
}
