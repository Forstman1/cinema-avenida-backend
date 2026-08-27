"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboard = getDashboard;
const prisma_1 = __importDefault(require("../config/prisma"));
const cinema_time_1 = require("../utils/cinema-time");
const cinema_1 = require("../config/cinema");
// GET /api/admin/dashboard — indicateurs d'exploitation pour le tableau de bord admin
async function getDashboard(req, res) {
    const now = new Date();
    const todayKey = (0, cinema_time_1.getCinemaDateTime)(now).date;
    const todayStart = (0, cinema_time_1.dateKeyToDate)(todayKey);
    const todayEnd = (0, cinema_time_1.addCalendarDays)(todayStart, 1);
    const weekStart = (0, cinema_time_1.getStartOfCinemaWeek)(now);
    const weekEnd = (0, cinema_time_1.addCalendarDays)(weekStart, 7);
    // Récupère toutes les réservations confirmées de la semaine avec leurs sièges et séances
    const confirmedReservations = await prisma_1.default.reservation.findMany({
        where: {
            status: "CONFIRMED",
            screening: {
                date: { gte: weekStart, lt: weekEnd },
            },
        },
        include: {
            reservationSeats: true,
            screening: { include: { movie: true } },
        },
    });
    // Réservations du jour
    const todayReservations = confirmedReservations.filter((r) => (0, cinema_time_1.getStoredCalendarDate)(r.screening.date) === todayKey);
    const todayRevenue = todayReservations.reduce((sum, r) => sum + r.totalAmount, 0);
    const todayReservationsCount = todayReservations.length;
    const todaySeatsSold = todayReservations.reduce((sum, r) => sum + r.reservationSeats.length, 0);
    // Toutes les séances du jour
    const todayScreenings = await prisma_1.default.screening.findMany({
        where: {
            date: { gte: todayStart, lt: todayEnd },
        },
    });
    const todayCapacity = todayScreenings.length * cinema_1.CINEMA_CONFIG.capacity;
    const todayOccupancyRate = todayCapacity > 0 ? Math.round((todaySeatsSold / todayCapacity) * 100) : 0;
    // Semaine en cours
    const weekRevenue = confirmedReservations.reduce((sum, r) => sum + r.totalAmount, 0);
    const weekReservationsCount = confirmedReservations.length;
    const weekSeatsSold = confirmedReservations.reduce((sum, r) => sum + r.reservationSeats.length, 0);
    const weekScreenings = await prisma_1.default.screening.findMany({
        where: {
            date: { gte: weekStart, lt: weekEnd },
        },
    });
    const weekCapacity = weekScreenings.length * cinema_1.CINEMA_CONFIG.capacity;
    const weekOccupancyRate = weekCapacity > 0 ? Math.round((weekSeatsSold / weekCapacity) * 100) : 0;
    // Film le plus réservé de la semaine
    const movieBookingCounts = new Map();
    for (const r of confirmedReservations) {
        const title = r.screening.movie.title;
        const current = movieBookingCounts.get(title) ?? { title, count: 0 };
        current.count += r.reservationSeats.length;
        movieBookingCounts.set(title, current);
    }
    const topMovie = Array.from(movieBookingCounts.values()).sort((a, b) => b.count - a.count)[0];
    // Statistiques rapides
    const totalMovies = await prisma_1.default.movie.count();
    const totalScreeningsThisWeek = weekScreenings.length;
    const pendingReservationsCount = await prisma_1.default.reservation.count({
        where: {
            status: "EN_ATTENTE",
            reservationSeats: {
                some: {
                    lockedUntil: { gt: now },
                },
            },
        },
    });
    const dashboard = {
        todayRevenue,
        todayReservationsCount,
        todayOccupancyRate,
        weekRevenue,
        weekReservationsCount,
        weekOccupancyRate,
        topMovieThisWeek: topMovie ?? null,
        quickStats: {
            totalMovies,
            totalScreeningsThisWeek,
            pendingReservationsCount,
        },
    };
    res.json(dashboard);
}
