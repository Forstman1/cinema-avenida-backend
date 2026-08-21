"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const movies_controller_1 = require("../controllers/movies.controller");
const router = (0, express_1.Router)();
router.get("/", movies_controller_1.getAllMovies);
router.get("/:id", movies_controller_1.getMovieById);
router.get("/:id/screenings", movies_controller_1.getScreeningsByMovie);
exports.default = router;
