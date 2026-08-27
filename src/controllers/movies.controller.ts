import { Request, Response } from "express";
import prisma from "../config/prisma";
import {
  addCalendarDays,
  getScreeningDateTime,
  getStartOfCinemaWeek,
  getStoredCalendarDate,
  isScreeningInFuture,
  isValidDateKey,
} from "../utils/cinema-time";

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
  const current = req.query.current === "true";

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
          },
          orderBy: [{ date: "asc" }, { showTime: "asc" }],
        },
      },
      orderBy: { title: "asc" },
    });

    const checkedAt = new Date();
    const currentMovies = movies
      .map((movie) => ({
        ...movie,
        screenings: movie.screenings
          .filter((screening) => isScreeningInFuture(screening, checkedAt))
          .map((screening) => ({
            ...screening,
            date: getStoredCalendarDate(screening.date),
          })),
      }))
      .filter((movie) => movie.screenings.length > 0);

    res.json(currentMovies);
    return;
  }

  // Admin / liste complète : films sans leurs séances
  const movies = await prisma.movie.findMany({
    orderBy: { title: "asc" },
  });
  res.json(movies);
}

// GET /api/movies/:id — détails d'un film
export async function getMovieById(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const movie = await prisma.movie.findUnique({ where: { id } });

  if (!movie) {
    res.status(404).json({ message: "Film non trouvé" });
    return;
  }

  res.json(movie);
}

// GET /api/movies/:id/screenings — séances d'un film
export async function getScreeningsByMovie(
  req: Request,
  res: Response
): Promise<void> {
  const movieId = Number(req.params.id);
  const requestedDate = req.query.date;

  if (
    requestedDate !== undefined &&
    (typeof requestedDate !== "string" || !isValidDateKey(requestedDate))
  ) {
    res.status(400).json({ message: "date doit être au format YYYY-MM-DD" });
    return;
  }

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

      return {
        ...screening,
        date: dateKey,
        availableSeats: Math.max(0, 120 - taken),
      };
    })
  );

  res.json(screeningsWithAvailability);
}

interface MovieBody {
  title: string;
  synopsis: string;
  duration: number;
  genre: string;
  poster?: string;
}

// POST /api/movies — créer un film (admin)
export async function createMovie(req: Request, res: Response): Promise<void> {
  const { title, synopsis, duration, genre, poster } = req.body as MovieBody;

  if (!title || !synopsis || !duration || !genre) {
    res
      .status(400)
      .json({ message: "Champs obligatoires : title, synopsis, duration, genre" });
    return;
  }

  const movie = await prisma.movie.create({
    data: {
      title,
      synopsis,
      duration: Number(duration),
      genre,
      poster,
    },
  });

  res.status(201).json(movie);
}

// PUT /api/movies/:id — modifier un film (admin)
export async function updateMovie(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { title, synopsis, duration, genre, poster } =
    req.body as Partial<MovieBody>;

  const existing = await prisma.movie.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ message: "Film non trouvé" });
    return;
  }

  const movie = await prisma.movie.update({
    where: { id },
    data: {
      title,
      synopsis,
      duration: duration ? Number(duration) : undefined,
      genre,
      poster,
    },
  });

  res.json(movie);
}
