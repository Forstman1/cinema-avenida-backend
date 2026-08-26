"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const screenings_controller_1 = require("../controllers/screenings.controller");
const router = (0, express_1.Router)();
// Admin route
router.get("/", auth_1.verifyToken, auth_1.isAdmin, screenings_controller_1.getScreeningsByDate);
// Public route
router.get("/:id/seats", screenings_controller_1.getSeatsByScreening);
// Admin route
router.post("/", auth_1.verifyToken, auth_1.isAdmin, screenings_controller_1.createScreening);
exports.default = router;
