import { Request, Response } from "express";
import prisma from "../config/prisma";

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

  const movie = await prisma.movie.findUnique({
    where: { id: Number(movieId) },
  });
  if (!movie) {
    res.status(404).json({ message: "Film non trouvé" });
    return;
  }

  try {
    const screening = await prisma.screening.create({
      data: {
        movieId: Number(movieId),
        date: new Date(date),
        showTime,
      },
    });
    res.status(201).json(screening);
  } catch {
    res.status(409).json({ message: "Conflit : cette séance existe déjà" });
  }
}
