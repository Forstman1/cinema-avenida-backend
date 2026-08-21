"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = verifyToken;
exports.isAdmin = isAdmin;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
function verifyToken(req, res, next) {
    const header = req.headers.authorization;
    if (!header) {
        res.status(401).json({ message: "Token manquant" });
        return;
    }
    try {
        req.user = jsonwebtoken_1.default.verify(header.split(" ")[1], process.env.JWT_SECRET);
        next();
    }
    catch {
        res.status(401).json({ message: "Token invalide" });
    }
}
// Réserve l'accès aux administrateurs
function isAdmin(req, res, next) {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Accès réservé à l'administrateur" });
        return;
    }
    next();
}
