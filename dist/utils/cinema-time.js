"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStoredCalendarDate = getStoredCalendarDate;
exports.getCinemaDateTime = getCinemaDateTime;
exports.isValidDateKey = isValidDateKey;
exports.dateKeyToDate = dateKeyToDate;
exports.addCalendarDays = addCalendarDays;
exports.getStartOfCinemaWeek = getStartOfCinemaWeek;
exports.cinemaDateTimeToDate = cinemaDateTimeToDate;
exports.getScreeningDateTime = getScreeningDateTime;
exports.isScreeningInFuture = isScreeningInFuture;
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
function formatParts(date) {
    return Object.fromEntries(cinemaDateTimeFormatter
        .formatToParts(date)
        .map(({ type, value }) => [type, value]));
}
/** The database stores Screening.date as a calendar date at UTC midnight. */
function getStoredCalendarDate(date) {
    return date.toISOString().slice(0, 10);
}
/** Returns the current instant represented in the cinema's local timezone. */
function getCinemaDateTime(date) {
    const parts = formatParts(date);
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}:${parts.second}`,
    };
}
function isValidDateKey(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }
    const [year, month, day] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day);
}
function dateKeyToDate(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}
function addCalendarDays(date, days) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}
function getStartOfCinemaWeek(date) {
    const monday = dateKeyToDate(getCinemaDateTime(date).date);
    const weekday = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
    return monday;
}
function getTimezoneOffsetMs(date) {
    const parts = formatParts(date);
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - date.getTime();
}
/**
 * Converts a cinema-local calendar date and HH:MM wall-clock time to an instant.
 * The small iteration handles timezone offset changes around DST transitions.
 */
function cinemaDateTimeToDate(dateKey, showTime) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const [hour, minute] = showTime.split(":").map(Number);
    const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    let result = wallClockAsUtc;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        result = wallClockAsUtc - getTimezoneOffsetMs(new Date(result));
    }
    return new Date(result);
}
function getScreeningDateTime(date, showTime) {
    return cinemaDateTimeToDate(getStoredCalendarDate(date), showTime);
}
function isScreeningInFuture(screening, now = new Date()) {
    return getScreeningDateTime(screening.date, screening.showTime).getTime() > now.getTime();
}
