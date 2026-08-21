import { Router } from "express";
import { signup, login } from "../controllers/auth.controller";

const router = Router();

router.post("/signup", signup); // BF-01
router.post("/login", login); // BF-02

export default router;
