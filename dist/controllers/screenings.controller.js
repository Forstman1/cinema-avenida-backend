"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreeningsByDate = getScreeningsByDate;
exports.getSeatsByScreening = getSeatsByScreening;
exports.createScreening = createScreening;
const prisma_1 = __importDefault(require("../config/prisma"));
const cinema_time_1 = require("../utils/cinema-time");
// GET /api/screenings?date=YYYY-MM-DD — liste les séances d'une journée (admin)
async function getScreeningsByDate(req, res) {
    const { date } = req.query;
    if (!date || typeof date !== "string" || !(0, cinema_time_1.isValidDateKey)(date)) {
        res
            .status(400)
            .json({ message: "Paramètre date requis au format YYYY-MM-DD" });
        return;
    }
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
    res.json(screenings.map((screening) => ({
        ...screening,
        date: (0, cinema_time_1.getStoredCalendarDate)(screening.date),
    })));
}
// GET /api/screenings/:id/seats — liste les sièges avec leur statut pour une séance
async function getSeatsByScreening(req, res) {
    const screeningId = Number(req.params.id);
    // Vérifie que la séance existe
    const screening = await prisma_1.default.screening.findUnique({
        where: { id: screeningId },
    });
    if (!screening) {
        res.status(404).json({ message: "Séance non trouvée" });
        return;
    }
    // Récupère les 120 sièges, triés par rangée et numéro
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
    const result = seats.map((seat) => ({
        ...seat,
        status: seatStatus.get(seat.id) || "LIBRE",
    }));
    res.json(result);
}
// POST /api/screenings — créer une séance (admin)
async function createScreening(req, res) {
    const { movieId, date, showTime } = req.body;
    if (!movieId || !date || !showTime) {
        res
            .status(400)
            .json({ message: "Champs obligatoires : movieId, date, showTime" });
        return;
    }
    const numericMovieId = Number(movieId);
    if (!Number.isInteger(numericMovieId) || numericMovieId <= 0) {
        res.status(400).json({ message: "movieId doit être un entier valide" });
        return;
    }
    if (!(0, cinema_time_1.isValidDateKey)(date)) {
        res.status(400).json({ message: "date doit être au format YYYY-MM-DD" });
        return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(showTime)) {
        res.status(400).json({ message: "showTime doit être au format HH:MM" });
        return;
    }
    const movie = await prisma_1.default.movie.findUnique({
        where: { id: numericMovieId },
    });
    if (!movie) {
        res.status(404).json({ message: "Film non trouvé" });
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
        const totalSeats = await prisma_1.default.seat.count();
        const occupiedSeats = await prisma_1.default.reservationSeat.count({
            where: {
                reservation: {
                    screeningId: screening.id,
                    status: { not: "CANCELLED" },
                },
            },
        });
        res.status(201).json({
            id: screening.id,
            date: screening.date.toISOString().split("T")[0],
            showTime: screening.showTime,
            movieId: screening.movieId,
            availableSeats: totalSeats - occupiedSeats,
        });
    }
    catch {
        res.status(409).json({ message: "Conflit : cette séance existe déjà" });
    }
}
