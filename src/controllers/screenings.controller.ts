import { Request, Response } from "express";
import prisma from "../config/prisma";
import { sendApiError } from "../utils/api-response";
import { toScreeningDTO, toSeatDTO } from "../utils/api-mappers";
import type { ScreeningRecord } from "../utils/api-mappers";
import type { SeatStatus, SuccessMessageDTO } from "../types/api";
import {
  parsePositiveId,
  parseRequiredDateQuery,
  parseScreeningCreateBody,
  parseScreeningUpdateBody,
} from "../validation/api";
import {
  addCalendarDays,
  dateKeyToDate,
  isScreeningInFuture,
} from "../utils/cinema-time";
import { CINEMA_CONFIG } from "../config/cinema";
import { Prisma } from "@prisma/client";

type ScreeningUpdateResult =
  | { kind: "screening_not_found" }
  | { kind: "movie_not_found" }
  | { kind: "screening_in_past" }
  | { kind: "has_reservations" }
  | { kind: "updated"; screening: ScreeningRecord };

type ScreeningDeleteResult =
  | { kind: "screening_not_found" }
  | { kind: "has_reservations" }
  | { kind: "deleted" };

const screeningMutationOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
} as const;

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

// PUT /api/screenings/:id — modifier une séance (admin)
export async function updateScreening(
  req: Request,
  res: Response
): Promise<void> {
  const parsedId = parsePositiveId(req.params.id, "Séance");
  if (!parsedId.ok) {
    sendApiError(res, 404, {
      message: "Séance non trouvée",
      code: "SCREENING_NOT_FOUND",
    });
    return;
  }

  const parsed = parseScreeningUpdateBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }

  const { movieId, date, showTime } = parsed.value;
  const dateValue = dateKeyToDate(date);

  try {
    const result = await prisma.$transaction(
      async (tx): Promise<ScreeningUpdateResult> => {
        const screening = await tx.screening.findUnique({
          where: { id: parsedId.value },
        });
        if (!screening) return { kind: "screening_not_found" };

        const movie = await tx.movie.findUnique({ where: { id: movieId } });
        if (!movie) return { kind: "movie_not_found" };

        if (!isScreeningInFuture({ date: dateValue, showTime })) {
          return { kind: "screening_in_past" };
        }

        const reservationCount = await tx.reservation.count({
          where: { screeningId: parsedId.value },
        });
        if (reservationCount > 0) return { kind: "has_reservations" };

        const updated = await tx.screening.update({
          where: { id: parsedId.value },
          data: {
            movieId,
            date: dateValue,
            showTime,
          },
          include: {
            movie: {
              select: { id: true, title: true },
            },
          },
        });

        return { kind: "updated", screening: updated };
      },
      screeningMutationOptions
    );

    if (result.kind === "screening_not_found") {
      sendApiError(res, 404, {
        message: "Séance non trouvée",
        code: "SCREENING_NOT_FOUND",
      });
      return;
    }
    if (result.kind === "movie_not_found") {
      sendApiError(res, 404, {
        message: "Film non trouvé",
        code: "MOVIE_NOT_FOUND",
      });
      return;
    }
    if (result.kind === "screening_in_past") {
      sendApiError(res, 400, {
        message: "Impossible de programmer une séance dans le passé",
        code: "SCREENING_IN_PAST",
      });
      return;
    }
    if (result.kind === "has_reservations") {
      sendApiError(res, 409, {
        message: "Cette séance possède déjà des réservations et ne peut pas être modifiée",
        code: "SCREENING_HAS_RESERVATIONS",
      });
      return;
    }

    res.json(toScreeningDTO(result.screening));
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      sendApiError(res, 409, {
        message: "Conflit lors de la modification de la séance, veuillez réessayer",
        code: "SCREENING_CONFLICT",
      });
      return;
    }
    throw error;
  }
}

// DELETE /api/screenings/:id — supprimer une séance sans historique (admin)
export async function deleteScreening(
  req: Request,
  res: Response
): Promise<void> {
  const parsedId = parsePositiveId(req.params.id, "Séance");
  if (!parsedId.ok) {
    sendApiError(res, 404, {
      message: "Séance non trouvée",
      code: "SCREENING_NOT_FOUND",
    });
    return;
  }

  try {
    const result = await prisma.$transaction(
      async (tx): Promise<ScreeningDeleteResult> => {
        const screening = await tx.screening.findUnique({
          where: { id: parsedId.value },
          select: { id: true },
        });
        if (!screening) return { kind: "screening_not_found" };

        const reservationCount = await tx.reservation.count({
          where: { screeningId: parsedId.value },
        });
        if (reservationCount > 0) return { kind: "has_reservations" };

        await tx.screening.delete({ where: { id: parsedId.value } });
        return { kind: "deleted" };
      },
      screeningMutationOptions
    );

    if (result.kind === "screening_not_found") {
      sendApiError(res, 404, {
        message: "Séance non trouvée",
        code: "SCREENING_NOT_FOUND",
      });
      return;
    }
    if (result.kind === "has_reservations") {
      sendApiError(res, 409, {
        message: "Cette séance possède déjà des réservations et ne peut pas être supprimée",
        code: "SCREENING_HAS_RESERVATIONS",
      });
      return;
    }

    const response: SuccessMessageDTO = { message: "Séance supprimée" };
    res.json(response);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      sendApiError(res, 404, {
        message: "Séance non trouvée",
        code: "SCREENING_NOT_FOUND",
      });
      return;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      sendApiError(res, 409, {
        message: "Conflit lors de la suppression de la séance, veuillez réessayer",
        code: "SCREENING_CONFLICT",
      });
      return;
    }
    throw error;
  }
}
