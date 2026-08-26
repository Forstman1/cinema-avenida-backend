"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScreeningsByDate = getScreeningsByDate;
exports.getSeatsByScreening = getSeatsByScreening;
exports.createScreening = createScreening;
const prisma_1 = __importDefault(require("../config/prisma"));
// GET /api/screenings?date=YYYY-MM-DD — liste les séances d'une journée (admin)
async function getScreeningsByDate(req, res) {
    const { date } = req.query;
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res
            .status(400)
            .json({ message: "Paramètre date requis au format YYYY-MM-DD" });
        return;
    }
    const start = new Date(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
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
    res.json(screenings);
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
    // Récupère les sièges déjà réservés/verrouillés pour cette séance
    const reservationSeats = await prisma_1.default.reservationSeat.findMany({
        where: {
            reservation: {
                screeningId,
                status: "CONFIRMED",
            },
        },
    });
    // Construit une map seatId -> statut
    const seatStatus = new Map();
    for (const rs of reservationSeats) {
        const isLocked = rs.lockedUntil && new Date(rs.lockedUntil) > new Date();
        seatStatus.set(rs.seatId, isLocked ? "VERROUILLE" : "OCCUPE");
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
    const movie = await prisma_1.default.movie.findUnique({
        where: { id: Number(movieId) },
    });
    if (!movie) {
        res.status(404).json({ message: "Film non trouvé" });
        return;
    }
    try {
        const screening = await prisma_1.default.screening.create({
            data: {
                movieId: Number(movieId),
                date: new Date(date),
                showTime,
            },
        });
        res.status(201).json(screening);
    }
    catch {
        res.status(409).json({ message: "Conflit : cette séance existe déjà" });
    }
}
