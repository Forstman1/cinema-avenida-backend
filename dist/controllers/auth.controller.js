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
// BF-01 : Inscription
async function signup(req, res) {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        res.status(400).json({ message: "Tous les champs sont obligatoires" });
        return;
    }
    const existe = await prisma_1.default.user.findUnique({ where: { email } });
    if (existe) {
        res.status(409).json({ message: "Cet email est déjà utilisé" });
        return;
    }
    const hash = await bcrypt_1.default.hash(password, 10);
    const user = await prisma_1.default.user.create({
        data: { name, email, password: hash },
    });
    res.status(201).json({ id: user.id, name: user.name, email: user.email });
}
// BF-02 : Connexion → renvoie un token JWT
async function login(req, res) {
    const { email, password } = req.body;
    const user = await prisma_1.default.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt_1.default.compare(password, user.password))) {
        res.status(401).json({ message: "Email ou mot de passe incorrect" });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
}
