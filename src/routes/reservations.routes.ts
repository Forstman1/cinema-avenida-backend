import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import {
  lockSeats,
  payReservation,
  getMyReservations,
  cancelReservation,
} from "../controllers/reservations.controller";

const router = Router();

router.post("/lock", verifyToken, lockSeats);
router.post("/:id/pay", verifyToken, payReservation);
router.get("/me", verifyToken, getMyReservations);
router.delete("/:id", verifyToken, cancelReservation);

export default router;
