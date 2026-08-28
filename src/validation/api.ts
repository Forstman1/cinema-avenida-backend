import {
  ApiErrorDTO,
  USER_ROLES,
  UserRole,
} from "../types/api";
import { CINEMA_CONFIG } from "../config/cinema";
import { isOfficialShowTime, isValidDateKey } from "../utils/cinema-time";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface MovieCreateInput {
  title: string;
  synopsis: string;
  duration: number;
  genre: string;
  poster?: string | null;
}

export interface MovieUpdateInput {
  title?: string;
  synopsis?: string;
  duration?: number;
  genre?: string;
  poster?: string | null;
}

export interface ScreeningCreateInput {
  movieId: number;
  date: string;
  showTime: string;
}

export type ScreeningUpdateInput = ScreeningCreateInput;

export interface LockSeatsInput {
  screeningId: number;
  seatIds: number[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiErrorDTO };

function success<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function failure(message: string, code = "INVALID_REQUEST"): ValidationResult<never> {
  return { ok: false, error: { message, code } };
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  field: string
): ValidationResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return failure(`${field} est obligatoire`, "INVALID_REQUEST");
  }
  return success(value);
}

function optionalString(
  value: unknown,
  field: string
): ValidationResult<string | null | undefined> {
  if (value === undefined || value === null) return success(value);
  if (typeof value !== "string") {
    return failure(`${field} doit être une chaîne de caractères`, "INVALID_REQUEST");
  }
  return success(value);
}

function positiveInteger(
  value: unknown,
  field: string
): ValidationResult<number> {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return failure(`${field} doit être un entier valide`, "INVALID_REQUEST");
  }
  return success(numericValue);
}

function positiveDuration(value: unknown): ValidationResult<number> {
  const result = positiveInteger(value, "duration");
  if (!result.ok) return result;
  return result;
}

export function parseSignupBody(input: unknown): ValidationResult<SignupInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const name = requiredString(body.name, "name");
  const email = requiredString(body.email, "email");
  const password = requiredString(body.password, "password");
  if (!name.ok) return name;
  if (!email.ok) return email;
  if (!password.ok) return password;
  return success({ name: name.value, email: email.value, password: password.value });
}

export function parseLoginBody(input: unknown): ValidationResult<LoginInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const email = requiredString(body.email, "email");
  const password = requiredString(body.password, "password");
  if (!email.ok) return email;
  if (!password.ok) return password;
  return success({ email: email.value, password: password.value });
}

export function parseMovieCreateBody(
  input: unknown
): ValidationResult<MovieCreateInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const title = requiredString(body.title, "title");
  const synopsis = requiredString(body.synopsis, "synopsis");
  const duration = positiveDuration(body.duration);
  const genre = requiredString(body.genre, "genre");
  const poster = optionalString(body.poster, "poster");
  if (!title.ok) return title;
  if (!synopsis.ok) return synopsis;
  if (!duration.ok) return duration;
  if (!genre.ok) return genre;
  if (!poster.ok) return poster;
  return success({
    title: title.value,
    synopsis: synopsis.value,
    duration: duration.value,
    genre: genre.value,
    poster: poster.value,
  });
}

export function parseMovieUpdateBody(
  input: unknown
): ValidationResult<MovieUpdateInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const result: MovieUpdateInput = {};
  if ("title" in body) {
    const value = requiredString(body.title, "title");
    if (!value.ok) return value;
    result.title = value.value;
  }
  if ("synopsis" in body) {
    const value = requiredString(body.synopsis, "synopsis");
    if (!value.ok) return value;
    result.synopsis = value.value;
  }
  if ("duration" in body) {
    const value = positiveDuration(body.duration);
    if (!value.ok) return value;
    result.duration = value.value;
  }
  if ("genre" in body) {
    const value = requiredString(body.genre, "genre");
    if (!value.ok) return value;
    result.genre = value.value;
  }
  if ("poster" in body) {
    const value = optionalString(body.poster, "poster");
    if (!value.ok) return value;
    result.poster = value.value;
  }
  return success(result);
}

function parseScreeningBody(
  input: unknown
): ValidationResult<ScreeningCreateInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const movieId = positiveInteger(body.movieId, "movieId");
  if (!movieId.ok) return movieId;

  if (typeof body.date !== "string" || !isValidDateKey(body.date)) {
    return failure("date doit être au format YYYY-MM-DD", "INVALID_DATE");
  }

  if (typeof body.showTime !== "string" || !isOfficialShowTime(body.showTime)) {
    return failure(
      `showTime doit être l'un des créneaux officiels : ${CINEMA_CONFIG.screeningSlots.join(
        ", "
      )}`,
      "INVALID_SHOW_TIME"
    );
  }

  return success({
    movieId: movieId.value,
    date: body.date,
    showTime: body.showTime,
  });
}

export function parseScreeningCreateBody(
  input: unknown
): ValidationResult<ScreeningCreateInput> {
  return parseScreeningBody(input);
}

export function parseScreeningUpdateBody(
  input: unknown
): ValidationResult<ScreeningUpdateInput> {
  return parseScreeningBody(input);
}

export function parseLockSeatsBody(
  input: unknown
): ValidationResult<LockSeatsInput> {
  const body = asRecord(input);
  if (!body) return failure("Le corps de la requête est invalide");

  const screeningId = positiveInteger(body.screeningId, "screeningId");
  if (!screeningId.ok) return screeningId;
  if (!Array.isArray(body.seatIds) || body.seatIds.length === 0) {
    return failure("seatIds doit contenir au moins un siège", "INVALID_SEATS");
  }

  const seatIds: number[] = [];
  for (const seatId of body.seatIds) {
    const parsedSeatId = positiveInteger(seatId, "seatId");
    if (!parsedSeatId.ok) return parsedSeatId;
    seatIds.push(parsedSeatId.value);
  }

  if (new Set(seatIds).size !== seatIds.length) {
    return failure("seatIds ne doit pas contenir de doublons", "INVALID_SEATS");
  }

  return success({ screeningId: screeningId.value, seatIds });
}

export function parsePositiveId(
  value: unknown,
  resourceName: string
): ValidationResult<number> {
  const result = positiveInteger(value, "id");
  if (!result.ok) {
    return failure(`${resourceName} non trouvé`, "INVALID_ID");
  }
  return result;
}

export function parseRequiredDateQuery(
  value: unknown
): ValidationResult<string> {
  if (typeof value !== "string" || !isValidDateKey(value)) {
    return failure("Paramètre date requis au format YYYY-MM-DD", "INVALID_DATE");
  }
  return success(value);
}

export function parseOptionalDateQuery(
  value: unknown
): ValidationResult<string | undefined> {
  if (value === undefined) return success(undefined);
  if (typeof value !== "string" || !isValidDateKey(value)) {
    return failure("date doit être au format YYYY-MM-DD", "INVALID_DATE");
  }
  return success(value);
}

export function parseBooleanQuery(
  value: unknown,
  field: string
): ValidationResult<boolean | undefined> {
  if (value === undefined) return success(undefined);
  if (value === "true") return success(true);
  if (value === "false") return success(false);
  return failure(`${field} doit être true ou false`, "INVALID_QUERY");
}

export function parseUserRole(value: unknown): UserRole | null {
  return typeof value === "string" &&
    (USER_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}
