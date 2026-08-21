import { Router } from "express";
import { verifyToken, isAdmin } from "../middleware/auth";
import {
  getSeatsByScreening,
  createScreening,
} from "../controllers/screenings.controller";

const router = Router();

// Public route
router.get("/:id/seats", getSeatsByScreening);

// Admin route
router.post("/", verifyToken, isAdmin, createScreening);

export default router;
