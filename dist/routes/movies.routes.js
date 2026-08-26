"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const movies_controller_1 = require("../controllers/movies.controller");
const router = (0, express_1.Router)();
// Public routes
router.get("/", movies_controller_1.getAllMovies);
router.get("/:id", movies_controller_1.getMovieById);
router.get("/:id/screenings", movies_controller_1.getScreeningsByMovie);
// Admin routes
router.post("/", auth_1.verifyToken, auth_1.isAdmin, movies_controller_1.createMovie);
router.put("/:id", auth_1.verifyToken, auth_1.isAdmin, movies_controller_1.updateMovie);
exports.default = router;
