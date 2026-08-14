require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth.routes"));
// TODO : app.use("/api/movies", require("./routes/movies.routes"));
// TODO : app.use("/api/screenings", require("./routes/screenings.routes"));
// TODO : app.use("/api/reservations", require("./routes/reservations.routes"));

app.get("/", (req, res) => res.json({ message: "API Cinéma Avenida 🎬" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API démarrée sur le port ${PORT}`));
