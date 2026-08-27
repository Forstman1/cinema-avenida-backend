import { Request, Response } from "express";
import prisma from "../config/prisma";

const CINEMA_TIMEZONE = process.env.CINEMA_TIMEZONE || "Africa/Casablanca";
const cinemaDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CINEMA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getCinemaDateTime(date: Date): {
  date: string;
  time: string;
} {
  const parts = Object.fromEntries(
    cinemaDateTimeFormatter.formatToParts(date).map(({ type, value }) => [
      type,
      value,
    ])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function isValidDateKey(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function getStartOfWeek(date: Date): Date {
  const { date: cinemaDate } = getCinemaDateTime(date);
  const [year, month, day] = cinemaDate.split("-").map(Number);
  const monday = new Date(Date.UTC(year, month - 1, day));
  const weekday = monday.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  monday.setUTCDate(monday.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return monday;
}

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
    const monday = getStartOfWeek(new Date());
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);

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

    res.json(
      movies.map((movie) => ({
        ...movie,
        screenings: movie.screenings.map((screening) => ({
          ...screening,
          date: getCinemaDateTime(screening.date).date,
        })),
      }))
    );
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

  const now = getCinemaDateTime(new Date());
  const screenings = await prisma.screening.findMany({
    where: { movieId },
    orderBy: [{ date: "asc" }, { showTime: "asc" }],
  });

  const futureScreenings = screenings
    .map((screening) => ({
      screening,
      cinemaDateTime: getCinemaDateTime(screening.date),
    }))
    .filter(({ cinemaDateTime }) => {
      if (requestedDate && cinemaDateTime.date !== requestedDate) {
        return false;
      }

      return (
        cinemaDateTime.date > now.date ||
        (cinemaDateTime.date === now.date && cinemaDateTime.time > now.time)
      );
    })
    .sort((a, b) => {
      const dateComparison = a.cinemaDateTime.date.localeCompare(
        b.cinemaDateTime.date
      );
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
    futureScreenings.map(async ({ screening, cinemaDateTime }) => {
      const taken = await prisma.reservationSeat.count({
        where: {
          reservation: {
            screeningId: screening.id,
            status: { in: ["CONFIRMED", "EN_ATTENTE"] },
          },
          OR: [
            { reservation: { status: "CONFIRMED" } },
            { lockedUntil: { gt: new Date() } },
          ],
        },
      });

      return {
        ...screening,
        date: cinemaDateTime.date,
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
