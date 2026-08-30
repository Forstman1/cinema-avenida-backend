"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toUserDTO = toUserDTO;
exports.toUserSummaryDTO = toUserSummaryDTO;
exports.toMovieSummaryDTO = toMovieSummaryDTO;
exports.toScreeningDTO = toScreeningDTO;
exports.toMovieDTO = toMovieDTO;
exports.toSeatDTO = toSeatDTO;
exports.toReservationSeatDTO = toReservationSeatDTO;
exports.toTicketDTO = toTicketDTO;
exports.toReservationDTO = toReservationDTO;
const api_1 = require("../types/api");
const cinema_time_1 = require("./cinema-time");
function enumValue(value, values, field) {
    if (values.includes(value))
        return value;
    throw new Error(`Valeur ${field} invalide dans les données API`);
}
function toUserRole(value) {
    return enumValue(value, api_1.USER_ROLES, "role");
}
function toReservationStatus(value) {
    return enumValue(value, api_1.RESERVATION_STATUSES, "status");
}
function toSeatCategory(value) {
    return enumValue(value, api_1.SEAT_CATEGORIES, "category");
}
function toTicketStatus(value) {
    return enumValue(value, api_1.TICKET_STATUSES, "status");
}
function toCalendarDate(value) {
    const date = (0, cinema_time_1.getStoredCalendarDate)(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Date de séance invalide dans les données API");
    }
    return date;
}
function toShowTime(value) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new Error("Heure de séance invalide dans les données API");
    }
    return value;
}
function toUserDTO(record) {
    return {
        id: record.id,
        name: record.name,
        email: record.email,
        role: toUserRole(record.role),
    };
}
function toUserSummaryDTO(record) {
    return { id: record.id, name: record.name, email: record.email };
}
function toMovieSummaryDTO(record) {
    return { id: record.id, title: record.title, poster: record.poster };
}
function toScreeningDTO(record) {
    const dto = {
        id: record.id,
        date: toCalendarDate(record.date),
        showTime: toShowTime(record.showTime),
        movieId: record.movieId,
    };
    if (record.movie)
        dto.movie = toMovieSummaryDTO(record.movie);
    if (record.availableSeats !== undefined) {
        dto.availableSeats = Number(record.availableSeats);
    }
    return dto;
}
function toMovieDTO(record) {
    const dto = {
        id: record.id,
        title: record.title,
        synopsis: record.synopsis,
        duration: Number(record.duration),
        genre: record.genre,
        poster: record.poster,
    };
    if (record.screenings) {
        dto.screenings = record.screenings.map(toScreeningDTO);
    }
    return dto;
}
function toSeatDTO(record, status = "LIBRE") {
    enumValue(status, api_1.SEAT_STATUSES, "status");
    return {
        id: record.id,
        row: record.row,
        number: record.number,
        category: toSeatCategory(record.category),
        status,
    };
}
function reservationSeatStatus(reservationStatus, lockedUntil, now) {
    if (reservationStatus === "CONFIRMED")
        return "OCCUPE";
    if (reservationStatus === "EN_ATTENTE" && lockedUntil && lockedUntil > now) {
        return "VERROUILLE";
    }
    return "LIBRE";
}
function toReservationSeatDTO(record, reservationStatus, now = new Date()) {
    return {
        id: record.id,
        lockedUntil: record.lockedUntil?.toISOString() ?? null,
        reservationId: record.reservationId,
        seatId: record.seatId,
        seat: toSeatDTO(record.seat, reservationSeatStatus(reservationStatus, record.lockedUntil, now)),
    };
}
function toTicketDTO(record) {
    return {
        id: record.id,
        qrCode: record.qrCode,
        status: toTicketStatus(record.status),
        reservationId: record.reservationId,
    };
}
function toReservationDTO(record, now = new Date()) {
    const status = toReservationStatus(record.status);
    const screening = toScreeningDTO(record.screening);
    if (!screening.movie) {
        throw new Error("Film de séance absent dans les données API");
    }
    const screeningWithMovie = {
        ...screening,
        movie: screening.movie,
    };
    return {
        id: record.id,
        totalAmount: Number(record.totalAmount),
        status,
        reservedAt: record.reservedAt.toISOString(),
        userId: record.userId,
        screeningId: record.screeningId,
        screening: screeningWithMovie,
        reservationSeats: record.reservationSeats.map((reservationSeat) => toReservationSeatDTO(reservationSeat, status, now)),
        ticket: record.ticket ? toTicketDTO(record.ticket) : null,
    };
}
