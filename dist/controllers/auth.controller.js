"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signup = signup;
exports.login = login;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../config/prisma"));
const api_response_1 = require("../utils/api-response");
const api_1 = require("../validation/api");
const api_mappers_1 = require("../utils/api-mappers");
// BF-01 : Inscription
async function signup(req, res) {
    const parsed = (0, api_1.parseSignupBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, {
            message: "Tous les champs sont obligatoires",
            code: parsed.error.code,
        });
        return;
    }
    const { name, email, password } = parsed.value;
    const existe = await prisma_1.default.user.findUnique({ where: { email } });
    if (existe) {
        (0, api_response_1.sendApiError)(res, 409, {
            message: "Cet email est déjà utilisé",
            code: "EMAIL_ALREADY_USED",
        });
        return;
    }
    const hash = await bcrypt_1.default.hash(password, 10);
    const user = await prisma_1.default.user.create({
        data: { name, email, password: hash },
    });
    res.status(201).json((0, api_mappers_1.toUserSummaryDTO)(user));
}
// BF-02 : Connexion → renvoie un token JWT
async function login(req, res) {
    const parsed = (0, api_1.parseLoginBody)(req.body);
    if (!parsed.ok) {
        (0, api_response_1.sendApiError)(res, 400, {
            message: "Tous les champs sont obligatoires",
            code: parsed.error.code,
        });
        return;
    }
    const { email, password } = parsed.value;
    const user = await prisma_1.default.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt_1.default.compare(password, user.password))) {
        (0, api_response_1.sendApiError)(res, 401, {
            message: "Email ou mot de passe incorrect",
            code: "INVALID_CREDENTIALS",
        });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const response = {
        token,
        user: (0, api_mappers_1.toUserDTO)(user),
    };
    res.json(response);
}
