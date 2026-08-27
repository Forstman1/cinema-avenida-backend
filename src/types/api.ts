export const USER_ROLES = ["CLIENT", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SEAT_STATUSES = ["LIBRE", "OCCUPE", "VERROUILLE"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const SEAT_CATEGORIES = ["CLUB", "NORMAL", "VIP"] as const;
export type SeatCategory = (typeof SEAT_CATEGORIES)[number];

export const RESERVATION_STATUSES = [
  "EN_ATTENTE",
  "CONFIRMED",
  "CANCELLED",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const TICKET_STATUSES = ["VALID", "CANCELLED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type CalendarDate = `${number}-${number}-${number}`;
export type ShowTime = `${number}:${number}`;

export interface CinemaConfigDTO {
  readonly capacity: number;
  readonly timezone: string;
  readonly screeningSlots: readonly ShowTime[];
  readonly seatCategories: Readonly<Record<SeatCategory, number>>;
}

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export type AuthUser = Pick<UserDTO, "id" | "role">;
export type UserSummaryDTO = Pick<UserDTO, "id" | "name" | "email">;

export interface MovieSummaryDTO {
  id: number;
  title: string;
}

export interface ScreeningDTO {
  id: number;
  date: CalendarDate;
  showTime: ShowTime;
  movieId: number;
  movie?: MovieSummaryDTO;
  availableSeats?: number;
}

export interface ScreeningWithMovieDTO extends ScreeningDTO {
  movie: MovieSummaryDTO;
}

export interface MovieDTO {
  id: number;
  title: string;
  synopsis: string;
  duration: number;
  genre: string;
  poster: string | null;
  screenings?: ScreeningDTO[];
}

export interface SeatDTO {
  id: number;
  row: string;
  number: number;
  category: SeatCategory;
  status: SeatStatus;
}

export interface ReservationSeatDTO {
  id: number;
  lockedUntil: string | null;
  reservationId: number;
  seatId: number;
  seat: SeatDTO;
}

export interface TicketDTO {
  id: number;
  qrCode: string;
  status: TicketStatus;
  reservationId: number;
}

export interface ReservationDTO {
  id: number;
  totalAmount: number;
  status: ReservationStatus;
  reservedAt: string;
  userId: number;
  screeningId: number;
  screening: ScreeningWithMovieDTO;
  reservationSeats: ReservationSeatDTO[];
  ticket: TicketDTO | null;
}

export interface AuthResponseDTO {
  token: string;
  user: UserDTO;
}

export interface MovieBookingSummaryDTO {
  title: string;
  count: number;
}

export interface AdminDashboardDTO {
  todayRevenue: number;
  todayReservationsCount: number;
  todayOccupancyRate: number;
  weekRevenue: number;
  weekReservationsCount: number;
  weekOccupancyRate: number;
  topMovieThisWeek: MovieBookingSummaryDTO | null;
  quickStats: {
    totalMovies: number;
    totalScreeningsThisWeek: number;
    pendingReservationsCount: number;
  };
}

export interface ApiErrorDTO {
  message: string;
  code?: string;
}

export interface PendingReservationErrorDTO extends ApiErrorDTO {
  pendingReservationId: number;
}

export interface SeatReferenceDTO {
  id: number;
  row: string;
  number: number;
}

export interface SeatsUnavailableErrorDTO extends ApiErrorDTO {
  seats: SeatReferenceDTO[];
}

export type ApiErrorResponseDTO =
  | ApiErrorDTO
  | PendingReservationErrorDTO
  | SeatsUnavailableErrorDTO;
