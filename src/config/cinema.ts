import baseCinemaConfig from "../../config/cinema-config.json";
import type { SeatCategory, ShowTime } from "../types/api";

export interface CinemaConfig {
  readonly capacity: number;
  readonly timezone: string;
  readonly screeningSlots: readonly ShowTime[];
  readonly seatCategories: Readonly<Record<SeatCategory, number>>;
}

const screeningSlots = Object.freeze(
  [...baseCinemaConfig.screeningSlots] as ShowTime[]
);
const seatCategories = Object.freeze({
  ...baseCinemaConfig.seatCategories,
}) as Readonly<Record<SeatCategory, number>>;

export const CINEMA_CONFIG: CinemaConfig = Object.freeze({
  capacity: baseCinemaConfig.capacity,
  timezone: process.env.CINEMA_TIMEZONE?.trim() || baseCinemaConfig.timezone,
  screeningSlots,
  seatCategories,
});
