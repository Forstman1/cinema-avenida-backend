"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreeningsByDate = getScreeningsByDate;
exports.getSeatsByScreening = getSeatsByScreening;
exports.createScreening = createScreening;
const prisma_1 = __importDefault(require("../config/prisma"));
const api_response_1 = require("../utils/api-response");
const api_mappers_1 = require("../utils/api-mappers");
const api_1 = require("../validation/api");
const cinema_time_1 = require("../utils/cinema-time");
const cinema_1 = require("../config/cinema");
const client_1 = require("@prisma/client");
// GET /api/screenings?date=YYYY-MM-DD — liste les séances d'une journée (admin)
async function getScreeningsByDate(req, res) {
    const parsedDate = (0, api_1.parseRequiredDateQuery)(req.query.date);
    if (!parsedDate.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedDate.error);
        return;
    }
    const date = parsedDate.value;
    const start = (0, cinema_time_1.dateKeyToDate)(date);
    const end = (0, cinema_time_1.addCalendarDays)(start, 1);
    const screenings = await prisma_1.default.screening.findMany({
        where: {
            date: {
                gte: start,
                lt: end,
            },
        },
        include: {
            movie: {
                select: { id: true, title: true },
            },
        },
        orderBy: { showTime: "asc" },
    });
    res.json(screenings.map(api_mappers_1.toScreeningDTO));
}
// GET /api/screenings/:id/seats — liste les sièges avec leur statut pour une séance
async function getSeatsByScreening(req, res) {
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Séance");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedId.error);
        return;
    }
    const screeningId = parsedId.value;
    // Vérifie que la séance existe
    const screening = await prisma_1.default.screening.findUnique({
        where: { id: screeningId },
    });
    if (!screening) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Séance non trouvée", code: "SCREENING_NOT_FOUND" });
        return;
    }
    // Récupère les sièges de la capacité configurée, triés par rangée et numéro
    const seats = await prisma_1.default.seat.findMany({
        orderBy: [{ row: "asc" }, { number: "asc" }],
    });
    const now = new Date();
    // Récupère les sièges déjà réservés/verrouillés pour cette séance
    const reservationSeats = await prisma_1.default.reservationSeat.findMany({
        where: {
            reservation: {
                screeningId,
                status: { in: ["CONFIRMED", "EN_ATTENTE"] },
            },
            OR: [
                { reservation: { status: "CONFIRMED" } },
                { lockedUntil: { gt: now } },
            ],
        },
        include: {
            reservation: { select: { status: true } },
        },
    });
    // Construit une map seatId -> statut
    const seatStatus = new Map();
    for (const rs of reservationSeats) {
        const isPending = rs.reservation.status === "EN_ATTENTE" &&
            rs.lockedUntil !== null &&
            rs.lockedUntil > now;
        seatStatus.set(rs.seatId, isPending ? "VERROUILLE" : "OCCUPE");
    }
    // Attache le statut à chaque siège (LIBRE par défaut)
    const result = seats.map((seat) => (0, api_mappers_1.toSeatDTO)(seat, seatStatus.get(seat.id) || "LIBRE"));
    res.json(result);
}
// POST /api/screenings — créer une séance (admin)
async function createScreening(req, res) {
    const parsed = (0, api_1.parseScreeningCreateBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsed.error);
        return;
    }
    const { movieId: numericMovieId, date, showTime } = parsed.value;
    const movie = await prisma_1.default.movie.findUnique({
        where: { id: numericMovieId },
    });
    if (!movie) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
        return;
    }
    try {
        const screening = await prisma_1.default.screening.create({
            data: {
                movieId: numericMovieId,
                date: (0, cinema_time_1.dateKeyToDate)(date),
                showTime,
            },
        });
        const occupiedSeats = await prisma_1.default.reservationSeat.count({
            where: {
                reservation: {
                    screeningId: screening.id,
                    status: { not: "CANCELLED" },
                },
            },
        });
        res.status(201).json((0, api_mappers_1.toScreeningDTO)({
            ...screening,
            availableSeats: Math.max(0, cinema_1.CINEMA_CONFIG.capacity - occupiedSeats),
        }));
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Conflit : ce créneau est déjà occupé pour cette date",
                code: "SCREENING_SLOT_CONFLICT",
            });
            return;
        }
        throw error;
    }
}
