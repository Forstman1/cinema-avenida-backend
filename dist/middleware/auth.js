"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdmin = exports.verifyToken = void 0;
exports.getAuthenticatedUser = getAuthenticatedUser;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const api_1 = require("../validation/api");
const api_response_1 = require("../utils/api-response");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getAuthenticatedUser(req) {
    const user = req.user;
    return user ?? null;
}
// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
const verifyToken = (req, res, next) => {
    const authReq = req;
    const header = authReq.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token manquant", code: "AUTH_REQUIRED" });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(header.slice("Bearer ".length), process.env.JWT_SECRET);
        if (!isRecord(decoded) || typeof decoded.id !== "number") {
            throw new Error("Invalid token payload");
        }
        const role = (0, api_1.parseUserRole)(decoded.role);
        if (role === null || !Number.isInteger(decoded.id) || decoded.id <= 0) {
            throw new Error("Invalid token payload");
        }
        authReq.user = { id: decoded.id, role };
        next();
    }
    catch {
        (0, api_response_1.sendApiError)(res, 401, { message: "Token invalide", code: "AUTH_INVALID" });
    }
};
exports.verifyToken = verifyToken;
// Réserve l'accès aux administrateurs
const isAdmin = (req, res, next) => {
    const user = getAuthenticatedUser(req);
    if (user?.role !== "ADMIN") {
        (0, api_response_1.sendApiError)(res, 403, {
            message: "Accès réservé à l'administrateur",
            code: "ADMIN_REQUIRED",
        });
        return;
    }
    next();
};
exports.isAdmin = isAdmin;
