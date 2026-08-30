import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import prisma from "../config/prisma";
import { AuthResponseDTO, UserDTO } from "../types/api";
import { getAuthenticatedUser } from "../middleware/auth";
import { sendApiError } from "../utils/api-response";
import {
  parseLoginBody,
  parseProfileUpdateBody,
  parseSignupBody,
} from "../validation/api";
import { toUserDTO, toUserSummaryDTO } from "../utils/api-mappers";

// BF-01 : Inscription
export async function signup(req: Request, res: Response): Promise<void> {
  const parsed = parseSignupBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, {
      message: "Tous les champs sont obligatoires",
      code: parsed.error.code,
    });
    return;
  }
  const { name, email, password } = parsed.value;

  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) {
    sendApiError(res, 409, {
      message: "Cet email est déjà utilisé",
      code: "EMAIL_ALREADY_USED",
    });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hash },
  });

  res.status(201).json(toUserSummaryDTO(user));
}

// BF-02 : Connexion → renvoie un token JWT
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = parseLoginBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, {
      message: "Tous les champs sont obligatoires",
      code: parsed.error.code,
    });
    return;
  }
  const { email, password } = parsed.value;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    sendApiError(res, 401, {
      message: "Email ou mot de passe incorrect",
      code: "INVALID_CREDENTIALS",
    });
    return;
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  const response: AuthResponseDTO = {
    token,
    user: toUserDTO(user),
  };

  res.json(response);
}

// PATCH /api/auth/me — modifier le nom de l'utilisateur authentifié
export async function updateProfile(req: Request, res: Response): Promise<void> {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    sendApiError(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
    return;
  }

  const parsed = parseProfileUpdateBody(req.body);
  if (!parsed.ok) {
    sendApiError(res, 400, parsed.error);
    return;
  }

  const user = await prisma.user.update({
    where: { id: authUser.id },
    data: { name: parsed.value.name },
  });

  const response: UserDTO = toUserDTO(user);
  res.json(response);
}
