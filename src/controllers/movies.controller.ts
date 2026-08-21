import { Request, Response } from "express";
import prisma from "../config/prisma";

// GET /api/movies — liste tous les films
export async function getAllMovies(req: Request, res: Response): Promise<void> {
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

  res.json(screenings);
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
