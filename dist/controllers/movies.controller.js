"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllMovies = getAllMovies;
exports.getMovieById = getMovieById;
exports.getScreeningsByMovie = getScreeningsByMovie;
const prisma_1 = __importDefault(require("../config/prisma"));
// GET /api/movies — liste tous les films
async function getAllMovies(req, res) {
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
    res.json(screenings);
}
