"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockSeats = lockSeats;
exports.payReservation = payReservation;
exports.getMyReservations = getMyReservations;
exports.cancelReservation = cancelReservation;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../config/prisma"));
const auth_1 = require("../middleware/auth");
const api_response_1 = require("../utils/api-response");
const api_mappers_1 = require("../utils/api-mappers");
const api_1 = require("../validation/api");
const cinema_time_1 = require("../utils/cinema-time");
const cinema_1 = require("../config/cinema");
const transaction_locks_1 = require("../utils/transaction-locks");
const MAX_SERIALIZATION_RETRIES = 3;
function isSerializationConflict(error) {
    return (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034");
}
function isTicketUniqueConflict(error) {
    return (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target === "Ticket_reservationId_key" ||
            (Array.isArray(error.meta?.target) &&
                error.meta.target.includes("reservationId"))));
}
async function runSerializableTransaction(callback) {
    let lastError;
    for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
        try {
            return await prisma_1.default.$transaction(callback, {
                isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
        }
        catch (error) {
            lastError = error;
            if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_RETRIES - 1) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
    throw lastError;
}
function hasActiveSeatLock(reservationSeats, now) {
    return reservationSeats.some((reservationSeat) => reservationSeat.lockedUntil !== null && reservationSeat.lockedUntil > now);
}
async function cancelPendingReservationIfExpired(tx, reservationId, reservationSeats, now) {
    if (hasActiveSeatLock(reservationSeats, now)) {
        return false;
    }
    const updated = await tx.reservation.updateMany({
        where: { id: reservationId, status: "EN_ATTENTE" },
        data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
        return false;
    }
    await tx.reservationSeat.updateMany({
        where: { reservationId },
        data: { lockedUntil: null },
    });
    return true;
}
async function expireStalePendingReservations(tx, userId, now) {
    const pendingReservations = await tx.reservation.findMany({
        where: { userId, status: "EN_ATTENTE" },
        select: {
            id: true,
            reservationSeats: { select: { lockedUntil: true } },
        },
    });
    for (const reservation of pendingReservations) {
        await cancelPendingReservationIfExpired(tx, reservation.id, reservation.reservationSeats, now);
    }
}
// POST /api/reservations/lock
async function lockSeats(req, res) {
    const user = (0, auth_1.getAuthenticatedUser)(req);
    if (!user) {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
        return;
    }
    const parsed = (0, api_1.parseLockSeatsBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsed.error);
        return;
    }
    const userId = user.id;
    const { screeningId: numericScreeningId, seatIds: numericSeatIds } = parsed.value;
    let result;
    try {
        result = await runSerializableTransaction(async (tx) => {
            // Serialize all lock attempts by this user so two requests cannot both
            // create an active pending reservation for the same account.
            await (0, transaction_locks_1.lockAdvisoryKey)(tx, 0, userId);
            // A screening deletion/update takes this same lock before checking
            // reservations, so no reservation can be created between that check
            // and the screening mutation.
            await (0, transaction_locks_1.lockScreening)(tx, numericScreeningId);
            // Serialize the requested screening/seat combinations across users. The
            // sorted order avoids deadlocks when two requests contain multiple seats.
            for (const seatId of [...numericSeatIds].sort((a, b) => a - b)) {
                await (0, transaction_locks_1.lockAdvisoryKey)(tx, numericScreeningId, seatId);
            }
            const now = new Date();
            await expireStalePendingReservations(tx, userId, now);
            // 1. Vérifie que la séance existe
            const screening = await tx.screening.findUnique({
                where: { id: numericScreeningId },
            });
            if (!screening)
                return { error: "screening_not_found" };
            if (!(0, cinema_time_1.isOfficialShowTime)(screening.showTime)) {
                return { error: "screening_invalid_time" };
            }
            if ((0, cinema_time_1.getScreeningDateTime)(screening.date, screening.showTime).getTime() <= now.getTime()) {
                return { error: "screening_in_past" };
            }
            // 2. Vérifie que l'utilisateur n'a pas déjà une réservation en attente verrouillée
            const activePending = await tx.reservation.findFirst({
                where: {
                    userId,
                    status: "EN_ATTENTE",
                    reservationSeats: {
                        some: {
                            lockedUntil: { gt: now },
                        },
                    },
                },
                orderBy: { reservedAt: "desc" },
            });
            if (activePending) {
                return {
                    error: "pending_exists",
                    pendingReservationId: activePending.id,
                };
            }
            // 3. Récupère les sièges demandés avec leurs catégories
            const seats = await tx.seat.findMany({
                where: { id: { in: numericSeatIds } },
            });
            if (seats.length !== numericSeatIds.length) {
                return { error: "seats_not_found" };
            }
            // 4. Vérifie que les sièges ne sont pas déjà pris
            // Pris = réservation CONFIRMÉE, ou EN_ATTENTE avec verrou encore actif
            const taken = await tx.reservationSeat.findMany({
                where: {
                    seatId: { in: numericSeatIds },
                    reservation: {
                        screeningId: numericScreeningId,
                        status: { in: ["CONFIRMED", "EN_ATTENTE"] },
                    },
                    OR: [
                        { reservation: { status: "CONFIRMED" } },
                        { lockedUntil: { gt: now } },
                    ],
                },
                include: {
                    seat: { select: { row: true, number: true } },
                },
            });
            if (taken.length > 0) {
                return {
                    error: "seats_unavailable",
                    seats: taken.map((rs) => ({
                        id: rs.seatId,
                        row: rs.seat.row,
                        number: rs.seat.number,
                    })),
                };
            }
            // 5. Calcule le montant total
            const totalAmount = seats.reduce((sum, seat) => sum + cinema_1.CINEMA_CONFIG.seatCategories[seat.category], 0);
            // 6. Crée la réservation EN_ATTENTE avec les sièges verrouillés 10 min
            const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
            const reservation = await tx.reservation.create({
                data: {
                    userId,
                    screeningId: numericScreeningId,
                    totalAmount,
                    status: "EN_ATTENTE",
                    reservationSeats: {
                        create: numericSeatIds.map((seatId) => ({
                            seatId,
                            lockedUntil: lockUntil,
                        })),
                    },
                },
                include: {
                    reservationSeats: { include: { seat: true } },
                    screening: { include: { movie: true } },
                    ticket: true,
                },
            });
            return { reservation, totalAmount };
        });
    }
    catch (error) {
        if (isSerializationConflict(error)) {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Conflit de réservation, veuillez réessayer",
                code: "RESERVATION_CONFLICT",
            });
            return;
        }
        throw error;
    }
    if ("error" in result) {
        if (result.error === "screening_not_found") {
            (0, api_response_1.sendApiError)(res, 404, { message: "Séance non trouvée", code: "SCREENING_NOT_FOUND" });
        }
        else if (result.error === "screening_in_past") {
            (0, api_response_1.sendApiError)(res, 400, { message: "Impossible de réserver une séance passée", code: "SCREENING_IN_PAST" });
        }
        else if (result.error === "screening_invalid_time") {
            (0, api_response_1.sendApiError)(res, 400, {
                message: "Impossible de réserver une séance avec un créneau non officiel",
                code: "INVALID_SHOW_TIME",
            });
        }
        else if (result.error === "pending_exists") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Vous avez déjà une réservation en cours. Terminez-la ou laissez-la expirer.",
                code: "PENDING_RESERVATION_EXISTS",
                pendingReservationId: result.pendingReservationId,
            });
        }
        else if (result.error === "seats_not_found") {
            (0, api_response_1.sendApiError)(res, 400, { message: "Certains sièges n'existent pas", code: "SEATS_NOT_FOUND" });
        }
        else if (result.error === "seats_unavailable") {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Certains sièges ne sont pas disponibles",
                code: "SEATS_UNAVAILABLE",
                seats: result.seats,
            });
        }
        return;
    }
    res.status(201).json((0, api_mappers_1.toReservationDTO)(result.reservation));
}
// POST /api/reservations/:id/pay
async function payReservation(req, res) {
    const user = (0, auth_1.getAuthenticatedUser)(req);
    if (!user) {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
        return;
    }
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Réservation");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
        return;
    }
    const userId = user.id;
    const reservationId = parsedId.value;
    let result;
    try {
        result = await runSerializableTransaction(async (tx) => {
            // A repeated payment for the same reservation is serialized, while the
            // unique Ticket.reservationId constraint is the final database guard.
            await (0, transaction_locks_1.lockAdvisoryKey)(tx, -1, reservationId);
            const reservation = await tx.reservation.findUnique({
                where: { id: reservationId },
                include: {
                    reservationSeats: { include: { seat: true } },
                    screening: { include: { movie: true } },
                    ticket: true,
                },
            });
            if (!reservation)
                return { error: "not_found" };
            if (reservation.userId !== userId)
                return { error: "forbidden" };
            // Idempotent success: payment retries return the existing ticket.
            if (reservation.status === "CONFIRMED" && reservation.ticket) {
                return { reservation };
            }
            if (reservation.status !== "EN_ATTENTE")
                return { error: "not_pending" };
            if (!(0, cinema_time_1.isOfficialShowTime)(reservation.screening.showTime)) {
                return { error: "screening_invalid_time" };
            }
            const now = new Date();
            // Every required seat lock must still be active; checking only one
            // lock could confirm a partially expired reservation. A reservation is
            // cancelled here only when none of its locks is still active.
            const locksValid = reservation.reservationSeats.length > 0 &&
                reservation.reservationSeats.every((rs) => rs.lockedUntil !== null && rs.lockedUntil > now);
            if (!locksValid) {
                await cancelPendingReservationIfExpired(tx, reservation.id, reservation.reservationSeats, now);
                return { error: "lock_expired" };
            }
            if ((0, cinema_time_1.getScreeningDateTime)(reservation.screening.date, reservation.screening.showTime).getTime() <= now.getTime()) {
                return { error: "screening_started" };
            }
            await tx.reservation.update({
                where: { id: reservationId },
                data: { status: "CONFIRMED" },
            });
            await tx.reservationSeat.updateMany({
                where: { reservationId },
                data: { lockedUntil: null },
            });
            await tx.ticket.create({
                data: {
                    reservationId,
                    qrCode: crypto_1.default.randomUUID(),
                    status: "VALID",
                },
            });
            const completedReservation = await tx.reservation.findUnique({
                where: { id: reservationId },
                include: {
                    reservationSeats: { include: { seat: true } },
                    screening: { include: { movie: true } },
                    ticket: true,
                },
            });
            if (!completedReservation)
                return { error: "not_found" };
            return { reservation: completedReservation };
        });
    }
    catch (error) {
        if (isTicketUniqueConflict(error)) {
            // Handles a concurrent payment from an older application instance that
            // does not take the advisory lock. Never issue a second ticket.
            const existing = await prisma_1.default.reservation.findUnique({
                where: { id: reservationId },
                include: {
                    reservationSeats: { include: { seat: true } },
                    screening: { include: { movie: true } },
                    ticket: true,
                },
            });
            if (existing?.userId === userId && existing.status === "CONFIRMED" && existing.ticket) {
                res.json((0, api_mappers_1.toReservationDTO)(existing));
                return;
            }
        }
        if (isSerializationConflict(error)) {
            (0, api_response_1.sendApiError)(res, 409, {
                message: "Conflit de paiement, veuillez réessayer",
                code: "PAYMENT_CONFLICT",
            });
            return;
        }
        throw error;
    }
    if ("error" in result) {
        if (result.error === "not_found") {
            (0, api_response_1.sendApiError)(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
        }
        else if (result.error === "forbidden") {
            (0, api_response_1.sendApiError)(res, 403, { message: "Accès refusé", code: "FORBIDDEN" });
        }
        else if (result.error === "not_pending") {
            (0, api_response_1.sendApiError)(res, 400, { message: "La réservation n'est pas en attente", code: "RESERVATION_NOT_PENDING" });
        }
        else if (result.error === "screening_started") {
            (0, api_response_1.sendApiError)(res, 400, {
                message: "Impossible de confirmer une réservation après le début de la séance",
                code: "SCREENING_STARTED",
            });
        }
        else if (result.error === "screening_invalid_time") {
            (0, api_response_1.sendApiError)(res, 400, {
                message: "Impossible de confirmer une séance avec un créneau non officiel",
                code: "INVALID_SHOW_TIME",
            });
        }
        else if (result.error === "lock_expired") {
            (0, api_response_1.sendApiError)(res, 410, { message: "Le verrou a expiré", code: "LOCK_EXPIRED" });
        }
        return;
    }
    res.json((0, api_mappers_1.toReservationDTO)(result.reservation));
}
// GET /api/reservations/me
async function getMyReservations(req, res) {
    const user = (0, auth_1.getAuthenticatedUser)(req);
    if (!user) {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
        return;
    }
    const userId = user.id;
    const reservations = await runSerializableTransaction(async (tx) => {
        await (0, transaction_locks_1.lockAdvisoryKey)(tx, 0, userId);
        const now = new Date();
        await expireStalePendingReservations(tx, userId, now);
        return tx.reservation.findMany({
            where: { userId },
            include: {
                screening: { include: { movie: true } },
                reservationSeats: { include: { seat: true } },
                ticket: true,
            },
            orderBy: { reservedAt: "desc" },
        });
    });
    res.json(reservations.map((reservation) => (0, api_mappers_1.toReservationDTO)(reservation)));
}
// DELETE /api/reservations/:id
async function cancelReservation(req, res) {
    const user = (0, auth_1.getAuthenticatedUser)(req);
    if (!user) {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
        return;
    }
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Réservation");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 404, {
            message: "Réservation non trouvée",
            code: "RESERVATION_NOT_FOUND",
        });
        return;
    }
    const userId = user.id;
    const reservationId = parsedId.value;
    const reservation = await prisma_1.default.reservation.findUnique({
        where: { id: reservationId },
        include: { screening: true, ticket: true },
    });
    if (!reservation) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
        return;
    }
    if (reservation.userId !== userId) {
        (0, api_response_1.sendApiError)(res, 403, { message: "Accès refusé", code: "FORBIDDEN" });
        return;
    }
    if (reservation.status !== "CONFIRMED") {
        (0, api_response_1.sendApiError)(res, 400, {
            message: "Seules les réservations confirmées peuvent être annulées",
            code: "RESERVATION_NOT_CONFIRMED",
        });
        return;
    }
    const screeningDateTime = (0, cinema_time_1.getScreeningDateTime)(reservation.screening.date, reservation.screening.showTime);
    const twoHoursBefore = new Date(screeningDateTime.getTime() - 2 * 60 * 60 * 1000);
    if (new Date() >= twoHoursBefore) {
        (0, api_response_1.sendApiError)(res, 400, {
            message: "Annulation impossible moins de 2 heures avant la séance",
            code: "CANCELLATION_WINDOW_CLOSED",
        });
        return;
    }
    await prisma_1.default.$transaction(async (tx) => {
        await tx.reservation.update({
            where: { id: reservationId },
            data: { status: "CANCELLED" },
        });
        if (reservation.ticket) {
            await tx.ticket.update({
                where: { id: reservation.ticket.id },
                data: { status: "CANCELLED" },
            });
        }
    });
    res.json({ message: "Réservation annulée" });
}
