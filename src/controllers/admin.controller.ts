import { Request, Response } from "express";
import prisma from "../config/prisma";
import { AdminDashboardDTO } from "../types/api";
import {
  addCalendarDays,
  getCinemaDateTime,
  getStartOfCinemaWeek,
  getStoredCalendarDate,
  dateKeyToDate,
} from "../utils/cinema-time";
import { CINEMA_CONFIG } from "../config/cinema";

// GET /api/admin/dashboard — indicateurs d'exploitation pour le tableau de bord admin
export async function getDashboard(req: Request, res: Response): Promise<void> {
  const now = new Date();
  const todayKey = getCinemaDateTime(now).date;
  const todayStart = dateKeyToDate(todayKey);
  const todayEnd = addCalendarDays(todayStart, 1);
  const weekStart = getStartOfCinemaWeek(now);
  const weekEnd = addCalendarDays(weekStart, 7);

  // Récupère toutes les réservations confirmées de la semaine avec leurs sièges et séances
  const confirmedReservations = await prisma.reservation.findMany({
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
  const todayReservations = confirmedReservations.filter(
    (r) => getStoredCalendarDate(r.screening.date) === todayKey
  );

  const todayRevenue = todayReservations.reduce((sum, r) => sum + r.totalAmount, 0);
  const todayReservationsCount = todayReservations.length;
  const todaySeatsSold = todayReservations.reduce(
    (sum, r) => sum + r.reservationSeats.length,
    0
  );

  // Toutes les séances du jour
  const todayScreenings = await prisma.screening.findMany({
    where: {
      date: { gte: todayStart, lt: todayEnd },
    },
  });
  const todayCapacity = todayScreenings.length * CINEMA_CONFIG.capacity;
  const todayOccupancyRate = todayCapacity > 0 ? Math.round((todaySeatsSold / todayCapacity) * 100) : 0;

  // Semaine en cours
  const weekRevenue = confirmedReservations.reduce((sum, r) => sum + r.totalAmount, 0);
  const weekReservationsCount = confirmedReservations.length;
  const weekSeatsSold = confirmedReservations.reduce(
    (sum, r) => sum + r.reservationSeats.length,
    0
  );

  const weekScreenings = await prisma.screening.findMany({
    where: {
      date: { gte: weekStart, lt: weekEnd },
    },
  });
  const weekCapacity = weekScreenings.length * CINEMA_CONFIG.capacity;
  const weekOccupancyRate = weekCapacity > 0 ? Math.round((weekSeatsSold / weekCapacity) * 100) : 0;

  // Film le plus réservé de la semaine
  const movieBookingCounts = new Map<string, { title: string; count: number }>();
  for (const r of confirmedReservations) {
    const title = r.screening.movie.title;
    const current = movieBookingCounts.get(title) ?? { title, count: 0 };
    current.count += r.reservationSeats.length;
    movieBookingCounts.set(title, current);
  }
  const topMovie = Array.from(movieBookingCounts.values()).sort(
    (a, b) => b.count - a.count
  )[0];

  // Statistiques rapides
  const totalMovies = await prisma.movie.count();
  const totalScreeningsThisWeek = weekScreenings.length;
  const pendingReservationsCount = await prisma.reservation.count({
    where: {
      status: "EN_ATTENTE",
      reservationSeats: {
        some: {
          lockedUntil: { gt: now },
        },
      },
    },
  });

  const dashboard: AdminDashboardDTO = {
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
