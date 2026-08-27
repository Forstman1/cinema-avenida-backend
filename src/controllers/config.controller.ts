import { Request, Response } from "express";
import { CINEMA_CONFIG } from "../config/cinema";
import { CinemaConfigDTO } from "../types/api";

// GET /api/config — configuration publique du cinéma
export function getCinemaConfig(_req: Request, res: Response): void {
  const response: CinemaConfigDTO = {
    capacity: CINEMA_CONFIG.capacity,
    timezone: CINEMA_CONFIG.timezone,
    screeningSlots: CINEMA_CONFIG.screeningSlots,
    seatCategories: CINEMA_CONFIG.seatCategories,
  };

  res.json(response);
}
