"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSeatsByScreening = getSeatsByScreening;
const prisma_1 = __importDefault(require("../config/prisma"));
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
