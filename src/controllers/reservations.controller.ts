import { Request, Response } from "express";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../config/prisma";
import { getAuthenticatedUser } from "../middleware/auth";
import { sendApiError } from "../utils/api-response";
import { toReservationDTO } from "../utils/api-mappers";
import {
  parseLockSeatsBody,
  parsePositiveId,
} from "../validation/api";
import {
  getScreeningDateTime,
  isOfficialShowTime,
} from "../utils/cinema-time";
import { CINEMA_CONFIG } from "../config/cinema";

const MAX_SERIALIZATION_RETRIES = 3;

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isTicketUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    (error.meta?.target === "Ticket_reservationId_key" ||
      (Array.isArray(error.meta?.target) &&
        error.meta.target.includes("reservationId")))
  );
}

async function runSerializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      });
    } catch (error) {
      lastError = error;
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_RETRIES - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }

  throw lastError;
}

/**
 * Transaction-scoped PostgreSQL advisory locks serialize access to a
 * screening/seat pair without preventing that same seat on another screening.
 * Namespace 0 is reserved for the per-user pending-reservation lock.
 */
async function lockAdvisoryKey(
  tx: Prisma.TransactionClient,
  namespace: number,
  key: number
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      CAST(${namespace} AS integer),
      CAST(${key} AS integer)
    )
  `;
}

// POST /api/reservations/lock
export async function lockSeats(req: Request, res: Response): Promise<void> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }

  const parsed = parseLockSeatsBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }
  const userId = user.id;
  const { screeningId: numericScreeningId, seatIds: numericSeatIds } = parsed.value;

  let result;
  try {
    result = await runSerializableTransaction(async (tx) => {
    // Serialize all lock attempts by this user so two requests cannot both
    // create an active pending reservation for the same account.
      await lockAdvisoryKey(tx, 0, userId);

    // Serialize the requested screening/seat combinations across users. The
    // sorted order avoids deadlocks when two requests contain multiple seats.
      for (const seatId of [...numericSeatIds].sort((a, b) => a - b)) {
        await lockAdvisoryKey(tx, numericScreeningId, seatId);
      }

      const now = new Date();
    // 1. Vérifie que la séance existe
    const screening = await tx.screening.findUnique({
      where: { id: numericScreeningId },
    });
    if (!screening) return { error: "screening_not_found" };

    if (!isOfficialShowTime(screening.showTime)) {
      return { error: "screening_invalid_time" };
    }

    if (getScreeningDateTime(screening.date, screening.showTime).getTime() <= now.getTime()) {
      return { error: "screening_in_past" };
    }

    // 2. Vérifie que l'utilisateur n'a pas déjà une réservation en attente verrouillée
    const activePending = await tx.reservation.findFirst({
      where: {
        userId,
        status: "EN_ATTENTE",
        reservationSeats: {
          some: {
            lockedUntil: { gt: now },
          },
        },
      },
      orderBy: { reservedAt: "desc" },
    });

    if (activePending) {
      return {
        error: "pending_exists",
        pendingReservationId: activePending.id,
      };
    }

    // 3. Récupère les sièges demandés avec leurs catégories
    const seats = await tx.seat.findMany({
      where: { id: { in: numericSeatIds } },
    });
    if (seats.length !== numericSeatIds.length) {
      return { error: "seats_not_found" };
    }

    // 4. Vérifie que les sièges ne sont pas déjà pris
    // Pris = réservation CONFIRMÉE, ou EN_ATTENTE avec verrou encore actif
    const taken = await tx.reservationSeat.findMany({
      where: {
        seatId: { in: numericSeatIds },
        reservation: {
          screeningId: numericScreeningId,
          status: { in: ["CONFIRMED", "EN_ATTENTE"] },
        },
        OR: [
          { reservation: { status: "CONFIRMED" } },
          { lockedUntil: { gt: now } },
        ],
      },
      include: {
        seat: { select: { row: true, number: true } },
      },
    });

    if (taken.length > 0) {
      return {
        error: "seats_unavailable",
        seats: taken.map((rs) => ({
          id: rs.seatId,
          row: rs.seat.row,
          number: rs.seat.number,
        })),
      };
    }

    // 5. Calcule le montant total
    const totalAmount = seats.reduce(
      (sum, seat) => sum + CINEMA_CONFIG.seatCategories[seat.category],
      0
    );

    // 6. Crée la réservation EN_ATTENTE avec les sièges verrouillés 10 min
    const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
      const reservation = await tx.reservation.create({
      data: {
        userId,
        screeningId: numericScreeningId,
        totalAmount,
        status: "EN_ATTENTE",
        reservationSeats: {
          create: numericSeatIds.map((seatId) => ({
            seatId,
            lockedUntil: lockUntil,
          })),
        },
      },
      include: {
        reservationSeats: { include: { seat: true } },
        screening: { include: { movie: true } },
        ticket: true,
      },
    });

    return { reservation, totalAmount };
    });
  } catch (error) {
    if (isSerializationConflict(error)) {
      sendApiError(res, 409, {
        message: "Conflit de réservation, veuillez réessayer",
        code: "RESERVATION_CONFLICT",
      });
      return;
    }
    throw error;
  }

  if ("error" in result) {
    if (result.error === "screening_not_found") {
      sendApiError(res, 404, { message: "Séance non trouvée", code: "SCREENING_NOT_FOUND" });
    } else if (result.error === "screening_in_past") {
      sendApiError(res, 400, { message: "Impossible de réserver une séance passée", code: "SCREENING_IN_PAST" });
    } else if (result.error === "screening_invalid_time") {
      sendApiError(res, 400, {
        message: "Impossible de réserver une séance avec un créneau non officiel",
        code: "INVALID_SHOW_TIME",
      });
    } else if (result.error === "pending_exists") {
      sendApiError(res, 409, {
        message:
          "Vous avez déjà une réservation en cours. Terminez-la ou laissez-la expirer.",
        code: "PENDING_RESERVATION_EXISTS",
        pendingReservationId: result.pendingReservationId,
      });
    } else if (result.error === "seats_not_found") {
      sendApiError(res, 400, { message: "Certains sièges n'existent pas", code: "SEATS_NOT_FOUND" });
    } else if (result.error === "seats_unavailable") {
      sendApiError(res, 409, {
        message: "Certains sièges ne sont pas disponibles",
        code: "SEATS_UNAVAILABLE",
        seats: result.seats,
      });
    }
    return;
  }

  res.status(201).json(toReservationDTO(result.reservation));
}

// POST /api/reservations/:id/pay
export async function payReservation(req: Request, res: Response): Promise<void> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }
  const parsedId = parsePositiveId(req.params.id, "Réservation");
  if (!parsedId.ok) {
    sendApiError(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
    return;
  }
  const userId = user.id;
  const reservationId = parsedId.value;

  let result;
  try {
    result = await runSerializableTransaction(async (tx) => {
      // A repeated payment for the same reservation is serialized, while the
      // unique Ticket.reservationId constraint is the final database guard.
      await lockAdvisoryKey(tx, -1, reservationId);

      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          reservationSeats: { include: { seat: true } },
          screening: { include: { movie: true } },
          ticket: true,
        },
      });

      if (!reservation) return { error: "not_found" };
      if (reservation.userId !== userId) return { error: "forbidden" };

      // Idempotent success: payment retries return the existing ticket.
      if (reservation.status === "CONFIRMED" && reservation.ticket) {
        return { reservation };
      }

      if (reservation.status !== "EN_ATTENTE") return { error: "not_pending" };

      if (!isOfficialShowTime(reservation.screening.showTime)) {
        return { error: "screening_invalid_time" };
      }

      const now = new Date();
      if (
        getScreeningDateTime(
          reservation.screening.date,
          reservation.screening.showTime
        ).getTime() <= now.getTime()
      ) {
        return { error: "screening_started" };
      }

      // Every required seat lock must still be active; checking only one
      // lock could confirm a partially expired reservation.
      const locksValid =
        reservation.reservationSeats.length > 0 &&
        reservation.reservationSeats.every(
          (rs) => rs.lockedUntil !== null && rs.lockedUntil > now
        );
      if (!locksValid) return { error: "lock_expired" };

      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: "CONFIRMED" },
      });

      await tx.reservationSeat.updateMany({
        where: { reservationId },
        data: { lockedUntil: null },
      });

      await tx.ticket.create({
        data: {
          reservationId,
          qrCode: crypto.randomUUID(),
          status: "VALID",
        },
      });

      const completedReservation = await tx.reservation.findUnique({
        where: { id: reservationId },
        include: {
          reservationSeats: { include: { seat: true } },
          screening: { include: { movie: true } },
          ticket: true,
        },
      });

      if (!completedReservation) return { error: "not_found" };
      return { reservation: completedReservation };
    });
  } catch (error) {
    if (isTicketUniqueConflict(error)) {
      // Handles a concurrent payment from an older application instance that
      // does not take the advisory lock. Never issue a second ticket.
      const existing = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          reservationSeats: { include: { seat: true } },
          screening: { include: { movie: true } },
          ticket: true,
        },
      });
      if (existing?.userId === userId && existing.status === "CONFIRMED" && existing.ticket) {
        res.json(toReservationDTO(existing));
        return;
      }
    }

    if (isSerializationConflict(error)) {
      sendApiError(res, 409, {
        message: "Conflit de paiement, veuillez réessayer",
        code: "PAYMENT_CONFLICT",
      });
      return;
    }
    throw error;
  }

  if ("error" in result) {
    if (result.error === "not_found") {
      sendApiError(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
    } else if (result.error === "forbidden") {
      sendApiError(res, 403, { message: "Accès refusé", code: "FORBIDDEN" });
    } else if (result.error === "not_pending") {
      sendApiError(res, 400, { message: "La réservation n'est pas en attente", code: "RESERVATION_NOT_PENDING" });
    } else if (result.error === "screening_started") {
      sendApiError(res, 400, {
        message: "Impossible de confirmer une réservation après le début de la séance",
        code: "SCREENING_STARTED",
      });
    } else if (result.error === "screening_invalid_time") {
      sendApiError(res, 400, {
        message: "Impossible de confirmer une séance avec un créneau non officiel",
        code: "INVALID_SHOW_TIME",
      });
    } else if (result.error === "lock_expired") {
      sendApiError(res, 410, { message: "Le verrou a expiré", code: "LOCK_EXPIRED" });
    }
    return;
  }

  res.json(toReservationDTO(result.reservation));
}

// GET /api/reservations/me
export async function getMyReservations(
  req: Request,
  res: Response
): Promise<void> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }
  const userId = user.id;

  const reservations = await prisma.reservation.findMany({
    where: { userId },
    include: {
      screening: { include: { movie: true } },
      reservationSeats: { include: { seat: true } },
      ticket: true,
    },
    orderBy: { reservedAt: "desc" },
  });

  res.json(reservations.map((reservation) => toReservationDTO(reservation)));
}

// DELETE /api/reservations/:id
export async function cancelReservation(
  req: Request,
  res: Response
): Promise<void> {
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }
  const parsedId = parsePositiveId(req.params.id, "Réservation");
  if (!parsedId.ok) {
    sendApiError(res, 404, {
      message: "Réservation non trouvée",
      code: "RESERVATION_NOT_FOUND",
    });
    return;
  }
  const userId = user.id;
  const reservationId = parsedId.value;

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { screening: true, ticket: true },
  });

  if (!reservation) {
    sendApiError(res, 404, { message: "Réservation non trouvée", code: "RESERVATION_NOT_FOUND" });
    return;
  }
  if (reservation.userId !== userId) {
    sendApiError(res, 403, { message: "Accès refusé", code: "FORBIDDEN" });
    return;
  }
  if (reservation.status !== "CONFIRMED") {
    sendApiError(res, 400, {
      message: "Seules les réservations confirmées peuvent être annulées",
      code: "RESERVATION_NOT_CONFIRMED",
    });
    return;
  }

  const screeningDateTime = getScreeningDateTime(
    reservation.screening.date,
    reservation.screening.showTime
  );
  const twoHoursBefore = new Date(
    screeningDateTime.getTime() - 2 * 60 * 60 * 1000
  );
  if (new Date() >= twoHoursBefore) {
    sendApiError(res, 400, {
      message: "Annulation impossible moins de 2 heures avant la séance",
      code: "CANCELLATION_WINDOW_CLOSED",
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CANCELLED" },
    });

    if (reservation.ticket) {
      await tx.ticket.update({
        where: { id: reservation.ticket.id },
        data: { status: "CANCELLED" },
      });
    }
  });

  res.json({ message: "Réservation annulée" });
}
