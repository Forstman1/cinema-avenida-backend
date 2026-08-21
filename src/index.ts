import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes";
import moviesRoutes from "./routes/movies.routes";
import screeningsRoutes from "./routes/screenings.routes";

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/movies", moviesRoutes);
app.use("/api/screenings", screeningsRoutes);

app.get("/", (req: Request, res: Response) =>
  res.json({ message: "API Cinéma Avenida 🎬" })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API démarrée sur le port ${PORT}`));
