import jwt from "jsonwebtoken";
import { Request, Response, NextFunction, RequestHandler } from "express";

export interface AuthRequest extends Request {
  user?: { id: number; role: string };
}

// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
export const verifyToken: RequestHandler = (req, res, next) => {
  const authReq = req as AuthRequest;
  const header = authReq.headers.authorization;
  if (!header) {
    res.status(401).json({ message: "Token manquant" });
    return;
  }

  try {
    authReq.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET!) as {
      id: number;
      role: string;
    };
    next();
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
};

// Réserve l'accès aux administrateurs
export const isAdmin: RequestHandler = (req, res, next) => {
  const authReq = req as AuthRequest;
  if (authReq.user?.role !== "ADMIN") {
    res.status(403).json({ message: "Accès réservé à l'administrateur" });
    return;
  }
  next();
};
