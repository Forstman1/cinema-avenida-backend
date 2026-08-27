import jwt from "jsonwebtoken";
import { Request, Response, RequestHandler } from "express";
import { AuthUser } from "../types/api";
import { parseUserRole } from "../validation/api";
import { sendApiError } from "../utils/api-response";

export interface AuthRequest extends Request {
  user?: AuthUser;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAuthenticatedUser(req: Request): AuthUser | null {
  const user = (req as AuthRequest).user;
  return user ?? null;
}

// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
export const verifyToken: RequestHandler = (req, res, next) => {
  const authReq = req as AuthRequest;
  const header = authReq.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }

  try {
    const decoded: unknown = jwt.verify(
      header.slice("Bearer ".length),
      process.env.JWT_SECRET!
    );
    if (!isRecord(decoded) || typeof decoded.id !== "number") {
      throw new Error("Invalid token payload");
    }
    const role = parseUserRole(decoded.role);
    if (role === null || !Number.isInteger(decoded.id) || decoded.id <= 0) {
      throw new Error("Invalid token payload");
    }
    authReq.user = { id: decoded.id, role };
    next();
  } catch {
    sendApiError(res, 401, { message: "Token invalide", code: "AUTH_INVALID" });
  }
};

// Réserve l'accès aux administrateurs
export const isAdmin: RequestHandler = (req, res, next) => {
  const user = getAuthenticatedUser(req);
  if (user?.role !== "ADMIN") {
    sendApiError(res, 403, {
      message: "Accès réservé à l'administrateur",
      code: "ADMIN_REQUIRED",
    });
    return;
  }
  next();
};
