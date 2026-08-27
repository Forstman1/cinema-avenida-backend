import { Request, Response } from "express";
import prisma from "../config/prisma";
import { Prisma } from "@prisma/client";
import { sendApiError } from "../utils/api-response";
import { toMovieDTO, toScreeningDTO } from "../utils/api-mappers";
import {
  parseBooleanQuery,
  parseMovieCreateBody,
  parseMovieUpdateBody,
  parseOptionalDateQuery,
  parsePositiveId,
} from "../validation/api";
import {
  addCalendarDays,
  getScreeningDateTime,
  getStartOfCinemaWeek,
  getStoredCalendarDate,
  isScreeningInFuture,
} from "../utils/cinema-time";
import { CINEMA_CONFIG } from "../config/cinema";

// GET /api/movies — liste tous les films
// Query: ?current=true → retourne le programme de la semaine en cours (films ayant
// au moins une séance à partir du lundi 00:00) avec leurs séances incluses.
//
// On filtre par séances plutôt qu'en stockant un flag "active" sur le film :
// le programme est piloté par les séances, pas par les films. Un film est visible
// et réservable uniquement s'il a au moins une séance future. Pas besoin d'activer
// ou désactiver manuellement — le temps fait le ménage automatiquement. Les
// anciennes données restent en base pour l'historique et les stats, l'application
// reste propre.
export async function getAllMovies(req: Request, res: Response): Promise<void> {
  const parsedCurrent = parseBooleanQuery(req.query.current, "current");
  if (!parsedCurrent.ok) {
    sendApiError(res, 400, parsedCurrent.error);
    return;
  }
  const current = parsedCurrent.value === true;

  if (current) {
    const now = new Date();
    const monday = getStartOfCinemaWeek(now);
    const nextMonday = addCalendarDays(monday, 7);

    const movies = await prisma.movie.findMany({
      where: {
        screenings: {
          some: {
            date: { gte: monday, lt: nextMonday },
          },
        },
      },
      include: {
        screenings: {
          where: {
            date: { gte: monday, lt: nextMonday },
          },
          select: {
            id: true,
            date: true,
            showTime: true,
            movieId: true,
          },
          orderBy: [{ date: "asc" }, { showTime: "asc" }],
        },
      },
      orderBy: { title: "asc" },
    });

    const checkedAt = new Date();
    const currentMovies = movies
      .map((movie) => ({
        ...toMovieDTO(movie),
        screenings: movie.screenings
          .filter((screening) => isScreeningInFuture(screening, checkedAt))
          .map(toScreeningDTO),
      }))
      .filter((movie) => movie.screenings.length > 0);

    res.json(currentMovies);
    return;
  }

  // Admin / liste complète : films sans leurs séances
  const movies = await prisma.movie.findMany({
    orderBy: { title: "asc" },
  });
  res.json(movies.map(toMovieDTO));
}

// GET /api/movies/:id — détails d'un film
export async function getMovieById(req: Request, res: Response): Promise<void> {
  const parsedId = parsePositiveId(req.params.id, "Film");
  if (!parsedId.ok) {
    sendApiError(res, 400, parsedId.error);
    return;
  }
  const id = parsedId.value;
  const movie = await prisma.movie.findUnique({ where: { id } });

  if (!movie) {
    sendApiError(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
    return;
  }

  res.json(toMovieDTO(movie));
}

// GET /api/movies/:id/screenings — séances d'un film
export async function getScreeningsByMovie(
  req: Request,
  res: Response
): Promise<void> {
  const parsedMovieId = parsePositiveId(req.params.id, "Film");
  if (!parsedMovieId.ok) {
    sendApiError(res, 400, parsedMovieId.error);
    return;
  }
  const parsedDate = parseOptionalDateQuery(req.query.date);
  if (!parsedDate.ok) {
    sendApiError(res, 400, parsedDate.error);
    return;
  }
  const movieId = parsedMovieId.value;
  const requestedDate = parsedDate.value;

  const now = new Date();
  const checkedAt = new Date();
  const screenings = await prisma.screening.findMany({
    where: { movieId },
    orderBy: [{ date: "asc" }, { showTime: "asc" }],
  });

  const futureScreenings = screenings
    .map((screening) => ({
      screening,
      dateKey: getStoredCalendarDate(screening.date),
      screeningDateTime: getScreeningDateTime(screening.date, screening.showTime),
    }))
    .filter(({ dateKey, screeningDateTime }) => {
      if (requestedDate && dateKey !== requestedDate) {
        return false;
      }

      return screeningDateTime.getTime() > now.getTime();
    })
    .sort((a, b) => {
      const dateComparison = a.dateKey.localeCompare(b.dateKey);
      if (dateComparison !== 0) {
        return dateComparison;
      }

      const timeComparison = a.screening.showTime.localeCompare(
        b.screening.showTime
      );
      return timeComparison !== 0
        ? timeComparison
        : a.screening.id - b.screening.id;
    });

  const screeningsWithAvailability = await Promise.all(
    futureScreenings.map(async ({ screening, dateKey }) => {
      const taken = await prisma.reservationSeat.count({
        where: {
          reservation: {
            screeningId: screening.id,
            status: { in: ["CONFIRMED", "EN_ATTENTE"] },
          },
          OR: [
            { reservation: { status: "CONFIRMED" } },
            { lockedUntil: { gt: checkedAt } },
          ],
        },
      });

      return toScreeningDTO({
        ...screening,
        availableSeats: Math.max(0, CINEMA_CONFIG.capacity - taken),
      });
    })
  );

  res.json(screeningsWithAvailability);
}

// POST /api/movies — créer un film (admin)
export async function createMovie(req: Request, res: Response): Promise<void> {
  const parsed = parseMovieCreateBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }
  const { title, synopsis, duration, genre, poster } = parsed.value;

  const movie = await prisma.movie.create({
    data: {
      title,
      synopsis,
      duration,
      genre,
      poster,
    },
  });

  res.status(201).json(toMovieDTO(movie));
}

// PUT /api/movies/:id — modifier un film (admin)
export async function updateMovie(req: Request, res: Response): Promise<void> {
  const parsedId = parsePositiveId(req.params.id, "Film");
  if (!parsedId.ok) {
    sendApiError(res, 400, parsedId.error);
    return;
  }
  const parsed = parseMovieUpdateBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }
  const id = parsedId.value;
  const { title, synopsis, duration, genre, poster } = parsed.value;

  const existing = await prisma.movie.findUnique({ where: { id } });
  if (!existing) {
    sendApiError(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
    return;
  }

  const data: Prisma.MovieUpdateInput = {
    title,
    synopsis,
    duration,
    genre,
    poster,
  };
  const movie = await prisma.movie.update({
    where: { id },
    data,
  });

  res.json(toMovieDTO(movie));
}
