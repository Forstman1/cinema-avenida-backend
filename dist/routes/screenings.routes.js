"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const screenings_controller_1 = require("../controllers/screenings.controller");
const router = (0, express_1.Router)();
router.get("/:id/seats", screenings_controller_1.getSeatsByScreening);
exports.default = router;
