import { Request, Response } from "express";
import prisma from "../config/prisma";

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // shift to Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
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

    const movies = await prisma.movie.findMany({
      where: {
        screenings: {
          some: {
            date: { gte: monday },
          },
        },
      },
      include: {
        screenings: {
          where: {
            date: { gte: monday },
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

    res.json(movies);
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
  const screenings = await prisma.screening.findMany({
    where: { movieId },
    orderBy: [{ date: "asc" }, { showTime: "asc" }],
  });

  const screeningsWithAvailability = await Promise.all(
    screenings.map(async (screening) => {
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
