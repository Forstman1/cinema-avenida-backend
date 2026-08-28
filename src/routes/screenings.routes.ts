import { Router } from "express";
import { verifyToken, isAdmin } from "../middleware/auth";
import {
  getScreeningsByDate,
  getSeatsByScreening,
  createScreening,
  updateScreening,
  deleteScreening,
} from "../controllers/screenings.controller";

const router = Router();

// Admin route
router.get("/", verifyToken, isAdmin, getScreeningsByDate);

// Public route
router.get("/:id/seats", getSeatsByScreening);

// Admin route
router.post("/", verifyToken, isAdmin, createScreening);
router.put("/:id", verifyToken, isAdmin, updateScreening);
router.delete("/:id", verifyToken, isAdmin, deleteScreening);

export default router;
