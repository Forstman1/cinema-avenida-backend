"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdmin = exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
const verifyToken = (req, res, next) => {
    const authReq = req;
    const header = authReq.headers.authorization;
    if (!header) {
        res.status(401).json({ message: "Token manquant" });
        return;
    }
    try {
        authReq.user = jsonwebtoken_1.default.verify(header.split(" ")[1], process.env.JWT_SECRET);
        next();
    }
    catch {
        res.status(401).json({ message: "Token invalide" });
    }
};
exports.verifyToken = verifyToken;
// Réserve l'accès aux administrateurs
const isAdmin = (req, res, next) => {
    const authReq = req;
    if (authReq.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Accès réservé à l'administrateur" });
        return;
    }
    next();
};
exports.isAdmin = isAdmin;
