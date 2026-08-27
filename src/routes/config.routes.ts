import { Router } from "express";
import { getCinemaConfig } from "../controllers/config.controller";

const router = Router();

router.get("/", getCinemaConfig);

export default router;
