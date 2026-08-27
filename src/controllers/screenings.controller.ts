import { Request, Response } from "express";
import prisma from "../config/prisma";
import { sendApiError } from "../utils/api-response";
import { toScreeningDTO, toSeatDTO } from "../utils/api-mappers";
import { SeatStatus } from "../types/api";
import {
  parsePositiveId,
  parseRequiredDateQuery,
  parseScreeningCreateBody,
} from "../validation/api";
import {
  addCalendarDays,
  dateKeyToDate,
} from "../utils/cinema-time";
import { CINEMA_CONFIG } from "../config/cinema";
import { Prisma } from "@prisma/client";

// GET /api/screenings?date=YYYY-MM-DD — liste les séances d'une journée (admin)
export async function getScreeningsByDate(
  req: Request,
  res: Response
): Promise<void> {
  const parsedDate = parseRequiredDateQuery(req.query.date);
  if (!parsedDate.ok) {
    sendApiError(res, 400, parsedDate.error);
    return;
  }
  const date = parsedDate.value;

  const start = dateKeyToDate(date);
  const end = addCalendarDays(start, 1);

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

  res.json(screenings.map(toScreeningDTO));
}

// GET /api/screenings/:id/seats — liste les sièges avec leur statut pour une séance
export async function getSeatsByScreening(
  req: Request,
  res: Response
): Promise<void> {
  const parsedId = parsePositiveId(req.params.id, "Séance");
  if (!parsedId.ok) {
    sendApiError(res, 400, parsedId.error);
    return;
  }
  const screeningId = parsedId.value;

  // Vérifie que la séance existe
  const screening = await prisma.screening.findUnique({
    where: { id: screeningId },
  });
  if (!screening) {
    sendApiError(res, 404, { message: "Séance non trouvée", code: "SCREENING_NOT_FOUND" });
    return;
  }

  // Récupère les sièges de la capacité configurée, triés par rangée et numéro
  const seats = await prisma.seat.findMany({
    orderBy: [{ row: "asc" }, { number: "asc" }],
  });

  const now = new Date();
  // Récupère les sièges déjà réservés/verrouillés pour cette séance
  const reservationSeats = await prisma.reservationSeat.findMany({
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
  const seatStatus = new Map<number, SeatStatus>();
  for (const rs of reservationSeats) {
    const isPending =
      rs.reservation.status === "EN_ATTENTE" &&
      rs.lockedUntil !== null &&
      rs.lockedUntil > now;
    seatStatus.set(rs.seatId, isPending ? "VERROUILLE" : "OCCUPE");
  }

  // Attache le statut à chaque siège (LIBRE par défaut)
  const result = seats.map((seat) =>
    toSeatDTO(seat, seatStatus.get(seat.id) || "LIBRE")
  );

  res.json(result);
}

// POST /api/screenings — créer une séance (admin)
export async function createScreening(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = parseScreeningCreateBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }
  const { movieId: numericMovieId, date, showTime } = parsed.value;

  const movie = await prisma.movie.findUnique({
    where: { id: numericMovieId },
  });
  if (!movie) {
    sendApiError(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
    return;
  }

  try {
    const screening = await prisma.screening.create({
      data: {
        movieId: numericMovieId,
        date: dateKeyToDate(date),
        showTime,
      },
    });

    const occupiedSeats = await prisma.reservationSeat.count({
      where: {
        reservation: {
          screeningId: screening.id,
          status: { not: "CANCELLED" },
        },
      },
    });

    res.status(201).json(
      toScreeningDTO({
        ...screening,
        availableSeats: Math.max(0, CINEMA_CONFIG.capacity - occupiedSeats),
      })
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      sendApiError(res, 409, {
        message: "Conflit : ce créneau est déjà occupé pour cette date",
        code: "SCREENING_SLOT_CONFLICT",
      });
      return;
    }

    throw error;
  }
}
