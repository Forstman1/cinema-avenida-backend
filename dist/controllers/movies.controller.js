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
const api_response_1 = require("../utils/api-response");
const api_mappers_1 = require("../utils/api-mappers");
const api_1 = require("../validation/api");
const cinema_time_1 = require("../utils/cinema-time");
const cinema_1 = require("../config/cinema");
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
    const parsedCurrent = (0, api_1.parseBooleanQuery)(req.query.current, "current");
    if (!parsedCurrent.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedCurrent.error);
        return;
    }
    const current = parsedCurrent.value === true;
    if (current) {
        const now = new Date();
        const monday = (0, cinema_time_1.getStartOfCinemaWeek)(now);
        const nextMonday = (0, cinema_time_1.addCalendarDays)(monday, 7);
        const movies = await prisma_1.default.movie.findMany({
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
            ...(0, api_mappers_1.toMovieDTO)(movie),
            screenings: movie.screenings
                .filter((screening) => (0, cinema_time_1.isScreeningInFuture)(screening, checkedAt))
                .map(api_mappers_1.toScreeningDTO),
        }))
            .filter((movie) => movie.screenings.length > 0);
        res.json(currentMovies);
        return;
    }
    // Admin / liste complète : films sans leurs séances
    const movies = await prisma_1.default.movie.findMany({
        orderBy: { title: "asc" },
    });
    res.json(movies.map(api_mappers_1.toMovieDTO));
}
// GET /api/movies/:id — détails d'un film
async function getMovieById(req, res) {
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Film");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedId.error);
        return;
    }
    const id = parsedId.value;
    const movie = await prisma_1.default.movie.findUnique({ where: { id } });
    if (!movie) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
        return;
    }
    res.json((0, api_mappers_1.toMovieDTO)(movie));
}
// GET /api/movies/:id/screenings — séances d'un film
async function getScreeningsByMovie(req, res) {
    const parsedMovieId = (0, api_1.parsePositiveId)(req.params.id, "Film");
    if (!parsedMovieId.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedMovieId.error);
        return;
    }
    const parsedDate = (0, api_1.parseOptionalDateQuery)(req.query.date);
    if (!parsedDate.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedDate.error);
        return;
    }
    const movieId = parsedMovieId.value;
    const requestedDate = parsedDate.value;
    const now = new Date();
    const checkedAt = new Date();
    const screenings = await prisma_1.default.screening.findMany({
        where: { movieId },
        orderBy: [{ date: "asc" }, { showTime: "asc" }],
    });
    const futureScreenings = screenings
        .map((screening) => ({
        screening,
        dateKey: (0, cinema_time_1.getStoredCalendarDate)(screening.date),
        screeningDateTime: (0, cinema_time_1.getScreeningDateTime)(screening.date, screening.showTime),
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
        const timeComparison = a.screening.showTime.localeCompare(b.screening.showTime);
        return timeComparison !== 0
            ? timeComparison
            : a.screening.id - b.screening.id;
    });
    const screeningsWithAvailability = await Promise.all(futureScreenings.map(async ({ screening, dateKey }) => {
        const taken = await prisma_1.default.reservationSeat.count({
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
        return (0, api_mappers_1.toScreeningDTO)({
            ...screening,
            availableSeats: Math.max(0, cinema_1.CINEMA_CONFIG.capacity - taken),
        });
    }));
    res.json(screeningsWithAvailability);
}
// POST /api/movies — créer un film (admin)
async function createMovie(req, res) {
    const parsed = (0, api_1.parseMovieCreateBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsed.error);
        return;
    }
    const { title, synopsis, duration, genre, poster } = parsed.value;
    const movie = await prisma_1.default.movie.create({
        data: {
            title,
            synopsis,
            duration,
            genre,
            poster,
        },
    });
    res.status(201).json((0, api_mappers_1.toMovieDTO)(movie));
}
// PUT /api/movies/:id — modifier un film (admin)
async function updateMovie(req, res) {
    const parsedId = (0, api_1.parsePositiveId)(req.params.id, "Film");
    if (!parsedId.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsedId.error);
        return;
    }
    const parsed = (0, api_1.parseMovieUpdateBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, parsed.error);
        return;
    }
    const id = parsedId.value;
    const { title, synopsis, duration, genre, poster } = parsed.value;
    const existing = await prisma_1.default.movie.findUnique({ where: { id } });
    if (!existing) {
        (0, api_response_1.sendApiError)(res, 404, { message: "Film non trouvé", code: "MOVIE_NOT_FOUND" });
        return;
    }
    const data = {
        title,
        synopsis,
        duration,
        genre,
        poster,
    };
    const movie = await prisma_1.default.movie.update({
        where: { id },
        data,
    });
    res.json((0, api_mappers_1.toMovieDTO)(movie));
}
