import {
  CalendarDate,
  MovieDTO,
  MovieSummaryDTO,
  ReservationDTO,
  ReservationSeatDTO,
  ReservationStatus,
  ScreeningDTO,
  ScreeningWithMovieDTO,
  SeatCategory,
  SeatDTO,
  SeatStatus,
  TicketDTO,
  TicketStatus,
  UserDTO,
  UserRole,
  RESERVATION_STATUSES,
  SEAT_CATEGORIES,
  SEAT_STATUSES,
  TICKET_STATUSES,
  USER_ROLES,
} from "../types/api";
import { getStoredCalendarDate } from "./cinema-time";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface MovieSummaryRecord {
  id: number;
  title: string;
}

export interface ScreeningRecord {
  id: number;
  date: Date;
  showTime: string;
  movieId: number;
  movie?: MovieSummaryRecord;
  availableSeats?: number;
}

export interface MovieRecord {
  id: number;
  title: string;
  synopsis: string;
  duration: number;
  genre: string;
  poster: string | null;
  screenings?: ScreeningRecord[];
}

export interface SeatRecord {
  id: number;
  row: string;
  number: number;
  category: string;
}

export interface ReservationSeatRecord {
  id: number;
  lockedUntil: Date | null;
  reservationId: number;
  seatId: number;
  seat: SeatRecord;
}

export interface TicketRecord {
  id: number;
  qrCode: string;
  status: string;
  reservationId: number;
}

export interface ReservationRecord {
  id: number;
  totalAmount: number;
  status: string;
  reservedAt: Date;
  userId: number;
  screeningId: number;
  screening: ScreeningRecord & { movie: MovieSummaryRecord };
  reservationSeats: ReservationSeatRecord[];
  ticket?: TicketRecord | null;
}

function enumValue<T extends string>(
  value: string,
  values: readonly T[],
  field: string
): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new Error(`Valeur ${field} invalide dans les données API`);
}

function toUserRole(value: string): UserRole {
  return enumValue(value, USER_ROLES, "role");
}

function toReservationStatus(value: string): ReservationStatus {
  return enumValue(value, RESERVATION_STATUSES, "status");
}

function toSeatCategory(value: string): SeatCategory {
  return enumValue(value, SEAT_CATEGORIES, "category");
}

function toTicketStatus(value: string): TicketStatus {
  return enumValue(value, TICKET_STATUSES, "status");
}

function toCalendarDate(value: Date): CalendarDate {
  const date = getStoredCalendarDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date de séance invalide dans les données API");
  }
  return date as CalendarDate;
}

function toShowTime(value: string): ScreeningDTO["showTime"] {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("Heure de séance invalide dans les données API");
  }
  return value as ScreeningDTO["showTime"];
}

export function toUserDTO(record: UserRecord): UserDTO {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: toUserRole(record.role),
  };
}

export function toUserSummaryDTO(
  record: Pick<UserRecord, "id" | "name" | "email">
): Pick<UserDTO, "id" | "name" | "email"> {
  return { id: record.id, name: record.name, email: record.email };
}

export function toMovieSummaryDTO(record: MovieSummaryRecord): MovieSummaryDTO {
  return { id: record.id, title: record.title };
}

export function toScreeningDTO(record: ScreeningRecord): ScreeningDTO {
  const dto: ScreeningDTO = {
    id: record.id,
    date: toCalendarDate(record.date),
    showTime: toShowTime(record.showTime),
    movieId: record.movieId,
  };

  if (record.movie) dto.movie = toMovieSummaryDTO(record.movie);
  if (record.availableSeats !== undefined) {
    dto.availableSeats = Number(record.availableSeats);
  }
  return dto;
}

export function toMovieDTO(record: MovieRecord): MovieDTO {
  const dto: MovieDTO = {
    id: record.id,
    title: record.title,
    synopsis: record.synopsis,
    duration: Number(record.duration),
    genre: record.genre,
    poster: record.poster,
  };
  if (record.screenings) {
    dto.screenings = record.screenings.map(toScreeningDTO);
  }
  return dto;
}

export function toSeatDTO(
  record: SeatRecord,
  status: SeatStatus = "LIBRE"
): SeatDTO {
  enumValue(status, SEAT_STATUSES, "status");
  return {
    id: record.id,
    row: record.row,
    number: record.number,
    category: toSeatCategory(record.category),
    status,
  };
}

function reservationSeatStatus(
  reservationStatus: ReservationStatus,
  lockedUntil: Date | null,
  now: Date
): SeatStatus {
  if (reservationStatus === "CONFIRMED") return "OCCUPE";
  if (reservationStatus === "EN_ATTENTE" && lockedUntil && lockedUntil > now) {
    return "VERROUILLE";
  }
  return "LIBRE";
}

export function toReservationSeatDTO(
  record: ReservationSeatRecord,
  reservationStatus: ReservationStatus,
  now = new Date()
): ReservationSeatDTO {
  return {
    id: record.id,
    lockedUntil: record.lockedUntil?.toISOString() ?? null,
    reservationId: record.reservationId,
    seatId: record.seatId,
    seat: toSeatDTO(
      record.seat,
      reservationSeatStatus(reservationStatus, record.lockedUntil, now)
    ),
  };
}

export function toTicketDTO(record: TicketRecord): TicketDTO {
  return {
    id: record.id,
    qrCode: record.qrCode,
    status: toTicketStatus(record.status),
    reservationId: record.reservationId,
  };
}

export function toReservationDTO(
  record: ReservationRecord,
  now = new Date()
): ReservationDTO {
  const status = toReservationStatus(record.status);
  const screening = toScreeningDTO(record.screening);
  if (!screening.movie) {
    throw new Error("Film de séance absent dans les données API");
  }

  const screeningWithMovie: ScreeningWithMovieDTO = {
    ...screening,
    movie: screening.movie,
  };

  return {
    id: record.id,
    totalAmount: Number(record.totalAmount),
    status,
    reservedAt: record.reservedAt.toISOString(),
    userId: record.userId,
    screeningId: record.screeningId,
    screening: screeningWithMovie,
    reservationSeats: record.reservationSeats.map((reservationSeat) =>
      toReservationSeatDTO(reservationSeat, status, now)
    ),
    ticket: record.ticket ? toTicketDTO(record.ticket) : null,
  };
}
