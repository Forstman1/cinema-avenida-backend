"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboard = getDashboard;
const prisma_1 = __importDefault(require("../config/prisma"));
function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
function getStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
// GET /api/admin/dashboard — indicateurs d'exploitation pour le tableau de bord admin
async function getDashboard(req, res) {
    const now = new Date();
    const todayStart = getStartOfDay(now);
    const todayEnd = addDays(todayStart, 1);
    const weekStart = getStartOfWeek(now);
    const weekEnd = addDays(weekStart, 7);
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
    const todayReservations = confirmedReservations.filter((r) => new Date(r.screening.date) >= todayStart &&
        new Date(r.screening.date) < todayEnd);
    const todayRevenue = todayReservations.reduce((sum, r) => sum + r.totalAmount, 0);
    const todayReservationsCount = todayReservations.length;
    const todaySeatsSold = todayReservations.reduce((sum, r) => sum + r.reservationSeats.length, 0);
    // Toutes les séances du jour
    const todayScreenings = await prisma_1.default.screening.findMany({
        where: {
            date: { gte: todayStart, lt: todayEnd },
        },
    });
    const todayCapacity = todayScreenings.length * 120;
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
    const weekCapacity = weekScreenings.length * 120;
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
    res.json({
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
    });
}
