const jwt = require("jsonwebtoken");

// Vérifie le token JWT envoyé dans le header Authorization: Bearer <token>
function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: "Token manquant" });
  try {
    req.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
}

// Réserve l'accès aux administrateurs
function isAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Accès réservé à l'administrateur" });
  next();
}

module.exports = { verifyToken, isAdmin };
