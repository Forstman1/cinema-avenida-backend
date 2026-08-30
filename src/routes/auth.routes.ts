import { Router } from "express";
import { signup, login, updateProfile } from "../controllers/auth.controller";
import { verifyToken } from "../middleware/auth";

const router = Router();

router.post("/signup", signup); // BF-01
router.post("/login", login); // BF-02
router.patch("/me", verifyToken, updateProfile);

export default router;
