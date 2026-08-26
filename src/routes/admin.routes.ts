import { Router } from "express";
import { verifyToken, isAdmin } from "../middleware/auth";
import { getDashboard } from "../controllers/admin.controller";

const router = Router();

// GET /api/admin/dashboard — indicateurs d'exploitation (admin uniquement)
router.get("/dashboard", verifyToken, isAdmin, getDashboard);

export default router;
