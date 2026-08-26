"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllMovies = getAllMovies;
exports.getMovieById = getMovieById;
exports.getScreeningsByMovie = getScreeningsByMovie;
exports.createMovie = createMovie;
exports.updateMovie = updateMovie;
const prisma_1 = __importDefault(require("../config/prisma"));
function getStartOfWeek(date) {
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
async function getAllMovies(req, res) {
    const current = req.query.current === "true";
    if (current) {
        const monday = getStartOfWeek(new Date());
        const movies = await prisma_1.default.movie.findMany({
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
    const movies = await prisma_1.default.movie.findMany({
        orderBy: { title: "asc" },
    });
    res.json(movies);
}
// GET /api/movies/:id — détails d'un film
async function getMovieById(req, res) {
    const id = Number(req.params.id);
    const movie = await prisma_1.default.movie.findUnique({ where: { id } });
    if (!movie) {
        res.status(404).json({ message: "Film non trouvé" });
        return;
    }
    res.json(movie);
}
// GET /api/movies/:id/screenings — séances d'un film
async function getScreeningsByMovie(req, res) {
    const movieId = Number(req.params.id);
    const screenings = await prisma_1.default.screening.findMany({
        where: { movieId },
        orderBy: [{ date: "asc" }, { showTime: "asc" }],
    });
    const screeningsWithAvailability = await Promise.all(screenings.map(async (screening) => {
        const taken = await prisma_1.default.reservationSeat.count({
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
    }));
    res.json(screeningsWithAvailability);
}
// POST /api/movies — créer un film (admin)
async function createMovie(req, res) {
    const { title, synopsis, duration, genre, poster } = req.body;
    if (!title || !synopsis || !duration || !genre) {
        res
            .status(400)
            .json({ message: "Champs obligatoires : title, synopsis, duration, genre" });
        return;
    }
    const movie = await prisma_1.default.movie.create({
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
async function updateMovie(req, res) {
    const id = Number(req.params.id);
    const { title, synopsis, duration, genre, poster } = req.body;
    const existing = await prisma_1.default.movie.findUnique({ where: { id } });
    if (!existing) {
        res.status(404).json({ message: "Film non trouvé" });
        return;
    }
    const movie = await prisma_1.default.movie.update({
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
