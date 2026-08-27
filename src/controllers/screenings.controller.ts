import { Request, Response } from "express";
import prisma from "../config/prisma";

// GET /api/screenings?date=YYYY-MM-DD — liste les séances d'une journée (admin)
export async function getScreeningsByDate(
  req: Request,
  res: Response
): Promise<void> {
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

  const screenings = await prisma.screening.findMany({
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
export async function getSeatsByScreening(
  req: Request,
  res: Response
): Promise<void> {
  const screeningId = Number(req.params.id);

  // Vérifie que la séance existe
  const screening = await prisma.screening.findUnique({
    where: { id: screeningId },
  });
  if (!screening) {
    res.status(404).json({ message: "Séance non trouvée" });
    return;
  }

  // Récupère les 120 sièges, triés par rangée et numéro
  const seats = await prisma.seat.findMany({
    orderBy: [{ row: "asc" }, { number: "asc" }],
  });

  // Récupère les sièges déjà réservés/verrouillés pour cette séance
  const reservationSeats = await prisma.reservationSeat.findMany({
    where: {
      reservation: {
        screeningId,
        status: "CONFIRMED",
      },
    },
  });

  // Construit une map seatId -> statut
  const seatStatus = new Map<number, string>();
  for (const rs of reservationSeats) {
    const isLocked =
      rs.lockedUntil && new Date(rs.lockedUntil) > new Date();
    seatStatus.set(rs.seatId, isLocked ? "VERROUILLE" : "OCCUPE");
  }

  // Attache le statut à chaque siège (LIBRE par défaut)
  const result = seats.map((seat) => ({
    ...seat,
    status: seatStatus.get(seat.id) || "LIBRE",
  }));

  res.json(result);
}

interface ScreeningBody {
  movieId: number;
  date: string;
  showTime: string;
}

// POST /api/screenings — créer une séance (admin)
export async function createScreening(
  req: Request,
  res: Response
): Promise<void> {
  const { movieId, date, showTime } = req.body as ScreeningBody;

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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ message: "date doit être au format YYYY-MM-DD" });
    return;
  }

  if (!/^\d{2}:\d{2}$/.test(showTime)) {
    res.status(400).json({ message: "showTime doit être au format HH:MM" });
    return;
  }

  const movie = await prisma.movie.findUnique({
    where: { id: numericMovieId },
  });
  if (!movie) {
    res.status(404).json({ message: "Film non trouvé" });
    return;
  }

  try {
    const screening = await prisma.screening.create({
      data: {
        movieId: numericMovieId,
        date: new Date(date),
        showTime,
      },
    });

    const totalSeats = await prisma.seat.count();
    const occupiedSeats = await prisma.reservationSeat.count({
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
  } catch {
    res.status(409).json({ message: "Conflit : cette séance existe déjà" });
  }
}
