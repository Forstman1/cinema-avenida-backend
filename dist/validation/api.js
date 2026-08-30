"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSignupBody = parseSignupBody;
exports.parseLoginBody = parseLoginBody;
exports.parseProfileUpdateBody = parseProfileUpdateBody;
exports.parseMovieCreateBody = parseMovieCreateBody;
exports.parseMovieUpdateBody = parseMovieUpdateBody;
exports.parseScreeningCreateBody = parseScreeningCreateBody;
exports.parseScreeningUpdateBody = parseScreeningUpdateBody;
exports.parseLockSeatsBody = parseLockSeatsBody;
exports.parsePositiveId = parsePositiveId;
exports.parseRequiredDateQuery = parseRequiredDateQuery;
exports.parseOptionalDateQuery = parseOptionalDateQuery;
exports.parseBooleanQuery = parseBooleanQuery;
exports.parseUserRole = parseUserRole;
const api_1 = require("../types/api");
const cinema_1 = require("../config/cinema");
const cinema_time_1 = require("../utils/cinema-time");
function success(value) {
    return { ok: true, value };
}
function failure(message, code = "INVALID_REQUEST") {
    return { ok: false, error: { message, code } };
}
function asRecord(input) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return null;
    }
    return input;
}
function requiredString(value, field) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return failure(`${field} est obligatoire`, "INVALID_REQUEST");
    }
    return success(value);
}
function optionalString(value, field) {
    if (value === undefined || value === null)
        return success(value);
    if (typeof value !== "string") {
        return failure(`${field} doit être une chaîne de caractères`, "INVALID_REQUEST");
    }
    return success(value);
}
function positiveInteger(value, field) {
    const numericValue = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : NaN;
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
        return failure(`${field} doit être un entier valide`, "INVALID_REQUEST");
    }
    return success(numericValue);
}
function positiveDuration(value) {
    const result = positiveInteger(value, "duration");
    if (!result.ok)
        return result;
    return result;
}
function parseSignupBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const name = requiredString(body.name, "name");
    const email = requiredString(body.email, "email");
    const password = requiredString(body.password, "password");
    if (!name.ok)
        return name;
    if (!email.ok)
        return email;
    if (!password.ok)
        return password;
    return success({ name: name.value, email: email.value, password: password.value });
}
function parseLoginBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const email = requiredString(body.email, "email");
    const password = requiredString(body.password, "password");
    if (!email.ok)
        return email;
    if (!password.ok)
        return password;
    return success({ email: email.value, password: password.value });
}
function parseProfileUpdateBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const name = requiredString(body.name, "name");
    if (!name.ok)
        return name;
    return success({ name: name.value.trim() });
}
function parseMovieCreateBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const title = requiredString(body.title, "title");
    const synopsis = requiredString(body.synopsis, "synopsis");
    const duration = positiveDuration(body.duration);
    const genre = requiredString(body.genre, "genre");
    const poster = optionalString(body.poster, "poster");
    if (!title.ok)
        return title;
    if (!synopsis.ok)
        return synopsis;
    if (!duration.ok)
        return duration;
    if (!genre.ok)
        return genre;
    if (!poster.ok)
        return poster;
    return success({
        title: title.value,
        synopsis: synopsis.value,
        duration: duration.value,
        genre: genre.value,
        poster: poster.value,
    });
}
function parseMovieUpdateBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const result = {};
    if ("title" in body) {
        const value = requiredString(body.title, "title");
        if (!value.ok)
            return value;
        result.title = value.value;
    }
    if ("synopsis" in body) {
        const value = requiredString(body.synopsis, "synopsis");
        if (!value.ok)
            return value;
        result.synopsis = value.value;
    }
    if ("duration" in body) {
        const value = positiveDuration(body.duration);
        if (!value.ok)
            return value;
        result.duration = value.value;
    }
    if ("genre" in body) {
        const value = requiredString(body.genre, "genre");
        if (!value.ok)
            return value;
        result.genre = value.value;
    }
    if ("poster" in body) {
        const value = optionalString(body.poster, "poster");
        if (!value.ok)
            return value;
        result.poster = value.value;
    }
    return success(result);
}
function parseScreeningBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const movieId = positiveInteger(body.movieId, "movieId");
    if (!movieId.ok)
        return movieId;
    if (typeof body.date !== "string" || !(0, cinema_time_1.isValidDateKey)(body.date)) {
        return failure("date doit être au format YYYY-MM-DD", "INVALID_DATE");
    }
    if (typeof body.showTime !== "string" || !(0, cinema_time_1.isOfficialShowTime)(body.showTime)) {
        return failure(`showTime doit être l'un des créneaux officiels : ${cinema_1.CINEMA_CONFIG.screeningSlots.join(", ")}`, "INVALID_SHOW_TIME");
    }
    return success({
        movieId: movieId.value,
        date: body.date,
        showTime: body.showTime,
    });
}
function parseScreeningCreateBody(input) {
    return parseScreeningBody(input);
}
function parseScreeningUpdateBody(input) {
    return parseScreeningBody(input);
}
function parseLockSeatsBody(input) {
    const body = asRecord(input);
    if (!body)
        return failure("Le corps de la requête est invalide");
    const screeningId = positiveInteger(body.screeningId, "screeningId");
    if (!screeningId.ok)
        return screeningId;
    if (!Array.isArray(body.seatIds) || body.seatIds.length === 0) {
        return failure("seatIds doit contenir au moins un siège", "INVALID_SEATS");
    }
    const seatIds = [];
    for (const seatId of body.seatIds) {
        const parsedSeatId = positiveInteger(seatId, "seatId");
        if (!parsedSeatId.ok)
            return parsedSeatId;
        seatIds.push(parsedSeatId.value);
    }
    if (new Set(seatIds).size !== seatIds.length) {
        return failure("seatIds ne doit pas contenir de doublons", "INVALID_SEATS");
    }
    return success({ screeningId: screeningId.value, seatIds });
}
function parsePositiveId(value, resourceName) {
    const result = positiveInteger(value, "id");
    if (!result.ok) {
        return failure(`${resourceName} non trouvé`, "INVALID_ID");
    }
    return result;
}
function parseRequiredDateQuery(value) {
    if (typeof value !== "string" || !(0, cinema_time_1.isValidDateKey)(value)) {
        return failure("Paramètre date requis au format YYYY-MM-DD", "INVALID_DATE");
    }
    return success(value);
}
function parseOptionalDateQuery(value) {
    if (value === undefined)
        return success(undefined);
    if (typeof value !== "string" || !(0, cinema_time_1.isValidDateKey)(value)) {
        return failure("date doit être au format YYYY-MM-DD", "INVALID_DATE");
    }
    return success(value);
}
function parseBooleanQuery(value, field) {
    if (value === undefined)
        return success(undefined);
    if (value === "true")
        return success(true);
    if (value === "false")
        return success(false);
    return failure(`${field} doit être true ou false`, "INVALID_QUERY");
}
function parseUserRole(value) {
    return typeof value === "string" &&
        api_1.USER_ROLES.includes(value)
        ? value
        : null;
}
