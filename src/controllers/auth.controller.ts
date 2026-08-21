import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import prisma from "../config/prisma";

// BF-01 : Inscription
export async function signup(req: Request, res: Response): Promise<void> {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ message: "Tous les champs sont obligatoires" });
    return;
  }

  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) {
    res.status(409).json({ message: "Cet email est déjà utilisé" });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hash },
  });

  res.status(201).json({ id: user.id, name: user.name, email: user.email });
}

// BF-02 : Connexion → renvoie un token JWT
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json({ message: "Email ou mot de passe incorrect" });
    return;
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}
