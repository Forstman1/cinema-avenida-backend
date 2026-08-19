const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

// BF-01 : Inscription
async function signup(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ message: "Tous les champs sont obligatoires" });
  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) return res.status(409).json({ message: "Cet email est déjà utilisé" });
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email, password: hash } });
  res.status(201).json({ id: user.id, name: user.name, email: user.email });
}

// BF-02 : Connexion → renvoie un token JWT
async function login(req, res) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ message: "Email ou mot de passe incorrect" });
  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

module.exports = { signup, login };
