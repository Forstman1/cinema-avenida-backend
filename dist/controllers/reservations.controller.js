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
const prisma_1 = __importDefault(require("../config/prisma"));
const cinema_time_1 = require("../utils/cinema-time");
const SEAT_PRICES = {
    CLUB: 45,
    NORMAL: 60,
    VIP: 90,
};
// POST /api/reservations/lock
async function lockSeats(req, res) {
    const userId = req.user.id;
    const { screeningId, seatIds } = req.body;
    if (!screeningId || !Array.isArray(seatIds) || seatIds.length === 0) {
        res.status(400).json({ message: "screeningId et seatIds sont obligatoires" });
        return;
    }
    const now = new Date();
    const result = await prisma_1.default.$transaction(async (tx) => {
        // 1. Vérifie que la séance existe
        const screening = await tx.screening.findUnique({
            where: { id: Number(screeningId) },
        });
        if (!screening)
            return { error: "screening_not_found" };
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
            where: { id: { in: seatIds.map(Number) } },
        });
        if (seats.length !== seatIds.length) {
            return { error: "seats_not_found" };
        }
        // 4. Vérifie que les sièges ne sont pas déjà pris
        // Pris = réservation CONFIRMÉE, ou EN_ATTENTE avec verrou encore actif
        const taken = await tx.reservationSeat.findMany({
            where: {
                seatId: { in: seatIds.map(Number) },
                reservation: {
                    screeningId: Number(screeningId),
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
        const totalAmount = seats.reduce((sum, seat) => sum + (SEAT_PRICES[seat.category] || 60), 0);
        // 6. Crée la réservation EN_ATTENTE avec les sièges verrouillés 10 min
        const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
        const reservation = await tx.reservation.create({
            data: {
                userId,
                screeningId: Number(screeningId),
                totalAmount,
                status: "EN_ATTENTE",
                reservationSeats: {
                    create: seatIds.map((seatId) => ({
                        seatId: Number(seatId),
                        lockedUntil: lockUntil,
                    })),
                },
            },
            include: {
                reservationSeats: { include: { seat: true } },
                screening: { include: { movie: true } },
            },
        });
        return { reservation, totalAmount };
    });
    if ("error" in result) {
        if (result.error === "screening_not_found") {
            res.status(404).json({ message: "Séance non trouvée" });
        }
        else if (result.error === "screening_in_past") {
            res.status(400).json({ message: "Impossible de réserver une séance passée" });
        }
        else if (result.error === "pending_exists") {
            res.status(409).json({
                message: "Vous avez déjà une réservation en cours. Terminez-la ou laissez-la expirer.",
                pendingReservationId: result.pendingReservationId,
            });
        }
        else if (result.error === "seats_not_found") {
            res.status(400).json({ message: "Certains sièges n'existent pas" });
        }
        else if (result.error === "seats_unavailable") {
            res.status(409).json({
                message: "Certains sièges ne sont pas disponibles",
                seats: result.seats,
            });
        }
        return;
    }
    res.status(201).json({
        ...result.reservation,
        screening: {
            ...result.reservation.screening,
            date: (0, cinema_time_1.getStoredCalendarDate)(result.reservation.screening.date),
        },
    });
}
// POST /api/reservations/:id/pay
async function payReservation(req, res) {
    const userId = req.user.id;
    const reservationId = Number(req.params.id);
    const result = await prisma_1.default.$transaction(async (tx) => {
        const reservation = await tx.reservation.findUnique({
            where: { id: reservationId },
            include: { reservationSeats: true },
        });
        if (!reservation)
            return { error: "not_found" };
        if (reservation.userId !== userId)
            return { error: "forbidden" };
        if (reservation.status !== "EN_ATTENTE")
            return { error: "not_pending" };
        const lockValid = reservation.reservationSeats.some((rs) => rs.lockedUntil && new Date(rs.lockedUntil) > new Date());
        if (!lockValid)
            return { error: "lock_expired" };
        await tx.reservation.update({
            where: { id: reservationId },
            data: { status: "CONFIRMED" },
        });
        await tx.reservationSeat.updateMany({
            where: { reservationId },
            data: { lockedUntil: null },
        });
        const ticket = await tx.ticket.create({
            data: {
                reservationId,
                qrCode: crypto_1.default.randomUUID(),
                status: "VALID",
            },
        });
        return {
            reservation: {
                ...reservation,
                status: "CONFIRMED",
                ticket,
            },
        };
    });
    if ("error" in result) {
        if (result.error === "not_found") {
            res.status(404).json({ message: "Réservation non trouvée" });
        }
        else if (result.error === "forbidden") {
            res.status(403).json({ message: "Accès refusé" });
        }
        else if (result.error === "not_pending") {
            res.status(400).json({ message: "La réservation n'est pas en attente" });
        }
        else if (result.error === "lock_expired") {
            res.status(410).json({ message: "Le verrou a expiré" });
        }
        return;
    }
    res.json(result.reservation);
}
// GET /api/reservations/me
async function getMyReservations(req, res) {
    const userId = req.user.id;
    const reservations = await prisma_1.default.reservation.findMany({
        where: { userId },
        include: {
            screening: { include: { movie: true } },
            reservationSeats: { include: { seat: true } },
            ticket: true,
        },
        orderBy: { reservedAt: "desc" },
    });
    res.json(reservations.map((reservation) => ({
        ...reservation,
        screening: {
            ...reservation.screening,
            date: (0, cinema_time_1.getStoredCalendarDate)(reservation.screening.date),
        },
    })));
}
// DELETE /api/reservations/:id
async function cancelReservation(req, res) {
    const userId = req.user.id;
    const reservationId = Number(req.params.id);
    const reservation = await prisma_1.default.reservation.findUnique({
        where: { id: reservationId },
        include: { screening: true, ticket: true },
    });
    if (!reservation) {
        res.status(404).json({ message: "Réservation non trouvée" });
        return;
    }
    if (reservation.userId !== userId) {
        res.status(403).json({ message: "Accès refusé" });
        return;
    }
    if (reservation.status !== "CONFIRMED") {
        res.status(400).json({
            message: "Seules les réservations confirmées peuvent être annulées",
        });
        return;
    }
    const screeningDateTime = (0, cinema_time_1.getScreeningDateTime)(reservation.screening.date, reservation.screening.showTime);
    const twoHoursBefore = new Date(screeningDateTime.getTime() - 2 * 60 * 60 * 1000);
    if (new Date() >= twoHoursBefore) {
        res.status(400).json({
            message: "Annulation impossible moins de 2 heures avant la séance",
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
