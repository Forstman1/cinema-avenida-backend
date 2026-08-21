"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const movies_routes_1 = __importDefault(require("./routes/movies.routes"));
const screenings_routes_1 = __importDefault(require("./routes/screenings.routes"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use("/api/auth", auth_routes_1.default);
app.use("/api/movies", movies_routes_1.default);
app.use("/api/screenings", screenings_routes_1.default);
app.get("/", (req, res) => res.json({ message: "API Cinéma Avenida 🎬" }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API démarrée sur le port ${PORT}`));
