"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreeningsByDate = getScreeningsByDate;
exports.getSeatsByScreening = getSeatsByScreening;
exports.createScreening = createScreening;
exports.updateScreening = updateScreening;
exports.deleteScreening = deleteScreening;
const prisma_1 = __importDefault(require("../config/prisma"));
const api_response_1 = require("../utils/api-response");
const api_mappers_1 = require("../utils/api-mappers");
const api_1 = require("../validation/api");
const cinema_time_1 = require("../utils/cinema-time");
const cinema_1 = require("../config/cinema");
const client_1 = require("@prisma/client");
const screeningMutationOptions = {
    isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 10000,
};
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
// PUT /api/screenings/:id — modifier une séance (admin)
async function updateScreening(req, res) {
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Séance");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 404, {
            message: "Séance non trouvée",
            code: "SCREENING_NOT_FOUND",
        });
        return;
    }
    const parsed = (0, api_1.parseScreeningUpdateBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsed.error);
        return;
    }
    const { movieId, date, showTime } = parsed.value;
    const dateValue = (0, cinema_time_1.dateKeyToDate)(date);
    try {
        const result = await prisma_1.default.$transaction(async (tx) => {
            const screening = await tx.screening.findUnique({
                where: { id: parsedId.value },
            });
            if (!screening)
                return { kind: "screening_not_found" };
            const movie = await tx.movie.findUnique({ where: { id: movieId } });
            if (!movie)
                return { kind: "movie_not_found" };
            if (!(0, cinema_time_1.isScreeningInFuture)({ date: dateValue, showTime })) {
                return { kind: "screening_in_past" };
            }
            const reservationCount = await tx.reservation.count({
                where: { screeningId: parsedId.value },
            });
            if (reservationCount > 0)
                return { kind: "has_reservations" };
            const updated = await tx.screening.update({
                where: { id: parsedId.value },
                data: {
                    movieId,
                    date: dateValue,
                    showTime,
                },
                include: {
                    movie: {
                        select: { id: true, title: true },
                    },
                },
            });
            return { kind: "updated", screening: updated };
        }, screeningMutationOptions);
        if (result.kind === "screening_not_found") {
            (0, api_response_1.sendApiError)(res, 404, {
                message: "Séance non trouvée",
                code: "SCREENING_NOT_FOUND",
            });
            return;
        }
        if (result.kind === "movie_not_found") {
            (0, api_response_1.sendApiError)(res, 404, {
                message: "Film non trouvé",
                code: "MOVIE_NOT_FOUND",
            });
            return;
        }
        if (result.kind === "screening_in_past") {
            (0, api_response_1.sendApiError)(res, 400, {
                message: "Impossible de programmer une séance dans le passé",
                code: "SCREENING_IN_PAST",
            });
            return;
        }
        if (result.kind === "has_reservations") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Cette séance possède déjà des réservations et ne peut pas être modifiée",
                code: "SCREENING_HAS_RESERVATIONS",
            });
            return;
        }
        res.json((0, api_mappers_1.toScreeningDTO)(result.screening));
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
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Conflit lors de la modification de la séance, veuillez réessayer",
                code: "SCREENING_CONFLICT",
            });
            return;
        }
        throw error;
    }
}
// DELETE /api/screenings/:id — supprimer une séance sans historique (admin)
async function deleteScreening(req, res) {
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Séance");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 404, {
            message: "Séance non trouvée",
            code: "SCREENING_NOT_FOUND",
        });
        return;
    }
    try {
        const result = await prisma_1.default.$transaction(async (tx) => {
            const screening = await tx.screening.findUnique({
                where: { id: parsedId.value },
                select: { id: true },
            });
            if (!screening)
                return { kind: "screening_not_found" };
            const reservationCount = await tx.reservation.count({
                where: { screeningId: parsedId.value },
            });
            if (reservationCount > 0)
                return { kind: "has_reservations" };
            await tx.screening.delete({ where: { id: parsedId.value } });
            return { kind: "deleted" };
        }, screeningMutationOptions);
        if (result.kind === "screening_not_found") {
            (0, api_response_1.sendApiError)(res, 404, {
                message: "Séance non trouvée",
                code: "SCREENING_NOT_FOUND",
            });
            return;
        }
        if (result.kind === "has_reservations") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Cette séance possède déjà des réservations et ne peut pas être supprimée",
                code: "SCREENING_HAS_RESERVATIONS",
            });
            return;
        }
        const response = { message: "Séance supprimée" };
        res.json(response);
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2025") {
            (0, api_response_1.sendApiError)(res, 404, {
                message: "Séance non trouvée",
                code: "SCREENING_NOT_FOUND",
            });
            return;
        }
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2034") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Conflit lors de la suppression de la séance, veuillez réessayer",
                code: "SCREENING_CONFLICT",
            });
            return;
        }
        throw error;
    }
}
