import { Router } from "express";
import { verifyToken, isAdmin } from "../middleware/auth";
import {
  getAllMovies,
  getMovieById,
  getScreeningsByMovie,
  createMovie,
  updateMovie,
} from "../controllers/movies.controller";

const router = Router();

// Public routes
router.get("/", getAllMovies);
router.get("/:id", getMovieById);
router.get("/:id/screenings", getScreeningsByMovie);

// Admin routes
router.post("/", verifyToken, isAdmin, createMovie);
router.put("/:id", verifyToken, isAdmin, updateMovie);

export default router;
