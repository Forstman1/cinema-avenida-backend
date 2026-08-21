import { Request, Response } from "express";
import crypto from "crypto";
import prisma from "../config/prisma";
import { AuthRequest } from "../middleware/auth";

const SEAT_PRICES: Record<string, number> = {
  CLUB: 45,
  NORMAL: 60,
  VIP: 90,
};

// POST /api/reservations/lock
export async function lockSeats(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthRequest).user!.id;
  const { screeningId, seatIds } = req.body as {
    screeningId: number;
    seatIds: number[];
  };

  if (!screeningId || !Array.isArray(seatIds) || seatIds.length === 0) {
    res.status(400).json({ message: "screeningId et seatIds sont obligatoires" });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Vérifie que la séance existe
    const screening = await tx.screening.findUnique({
      where: { id: Number(screeningId) },
    });
    if (!screening) return { error: "screening_not_found" };

    // 2. Récupère les sièges demandés avec leurs catégories
    const seats = await tx.seat.findMany({
      where: { id: { in: seatIds.map(Number) } },
    });
    if (seats.length !== seatIds.length) {
      return { error: "seats_not_found" };
    }

    // 3. Vérifie que les sièges ne sont pas déjà pris
    // Pris = réservation CONFIRMÉE, ou EN_ATTENTE avec verrou encore actif
    const taken = await tx.reservationSeat.findMany({
      where: {
        seatId: { in: seatIds.map(Number) },
        reservation: {
          screeningId: Number(screeningId),
          status: { in: ["CONFIRMED", "EN_ATTENTE"] },
        },
        OR: [
          { reservation: { status: "CONFIRMED" } },
          { lockedUntil: { gt: new Date() } },
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

    // 4. Calcule le montant total
    const totalAmount = seats.reduce(
      (sum, seat) => sum + (SEAT_PRICES[seat.category] || 60),
      0
    );

    // 5. Crée la réservation EN_ATTENTE avec les sièges verrouillés 10 min
    const lockUntil = new Date(Date.now() + 10 * 60 * 1000);
    const reservation = await tx.reservation.create({
      data: {
        userId,
        screeningId: Number(screeningId),
        totalAmount,
        status: "EN_ATTENTE",
        reservationSeats: {
          create: seatIds.map((seatId) => ({
            seatId: Number(seatId),
            lockedUntil: lockUntil,
          })),
        },
      },
      include: {
        reservationSeats: { include: { seat: true } },
        screening: { include: { movie: true } },
      },
    });

    return { reservation, totalAmount };
  });

  if ("error" in result) {
    if (result.error === "screening_not_found") {
      res.status(404).json({ message: "Séance non trouvée" });
    } else if (result.error === "seats_not_found") {
      res.status(400).json({ message: "Certains sièges n'existent pas" });
    } else if (result.error === "seats_unavailable") {
      res.status(409).json({
        message: "Certains sièges ne sont pas disponibles",
        seats: result.seats,
      });
    }
    return;
  }

  res.status(201).json(result.reservation);
}

// POST /api/reservations/:id/pay
export async function payReservation(req: Request, res: Response): Promise<void> {
  const userId = (req as AuthRequest).user!.id;
  const reservationId = Number(req.params.id);

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { reservationSeats: true },
    });

    if (!reservation) return { error: "not_found" };
    if (reservation.userId !== userId) return { error: "forbidden" };
    if (reservation.status !== "EN_ATTENTE") return { error: "not_pending" };

    const lockValid = reservation.reservationSeats.some(
      (rs) => rs.lockedUntil && new Date(rs.lockedUntil) > new Date()
    );
    if (!lockValid) return { error: "lock_expired" };

    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CONFIRMED" },
    });

    await tx.reservationSeat.updateMany({
      where: { reservationId },
      data: { lockedUntil: null },
    });

    const ticket = await tx.ticket.create({
      data: {
        reservationId,
        qrCode: crypto.randomUUID(),
        status: "VALID",
      },
    });

    return {
      reservation: {
        ...reservation,
        status: "CONFIRMED" as const,
        ticket,
      },
    };
  });

  if ("error" in result) {
    if (result.error === "not_found") {
      res.status(404).json({ message: "Réservation non trouvée" });
    } else if (result.error === "forbidden") {
      res.status(403).json({ message: "Accès refusé" });
    } else if (result.error === "not_pending") {
      res.status(400).json({ message: "La réservation n'est pas en attente" });
    } else if (result.error === "lock_expired") {
      res.status(410).json({ message: "Le verrou a expiré" });
    }
    return;
  }

  res.json(result.reservation);
}

// GET /api/reservations/me
export async function getMyReservations(
  req: Request,
  res: Response
): Promise<void> {
  const userId = (req as AuthRequest).user!.id;

  const reservations = await prisma.reservation.findMany({
    where: { userId },
    include: {
      screening: { include: { movie: true } },
      reservationSeats: { include: { seat: true } },
      ticket: true,
    },
    orderBy: { reservedAt: "desc" },
  });

  res.json(reservations);
}

// DELETE /api/reservations/:id
export async function cancelReservation(
  req: Request,
  res: Response
): Promise<void> {
  const userId = (req as AuthRequest).user!.id;
  const reservationId = Number(req.params.id);

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { screening: true, ticket: true },
  });

  if (!reservation) {
    res.status(404).json({ message: "Réservation non trouvée" });
    return;
  }
  if (reservation.userId !== userId) {
    res.status(403).json({ message: "Accès refusé" });
    return;
  }
  if (reservation.status !== "CONFIRMED") {
    res.status(400).json({
      message: "Seules les réservations confirmées peuvent être annulées",
    });
    return;
  }

  const twoHoursBefore = new Date(
    reservation.screening.date.getTime() - 2 * 60 * 60 * 1000
  );
  if (new Date() >= twoHoursBefore) {
    res.status(400).json({
      message: "Annulation impossible moins de 2 heures avant la séance",
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
