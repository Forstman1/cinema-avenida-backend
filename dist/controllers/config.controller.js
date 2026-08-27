"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCinemaConfig = getCinemaConfig;
const cinema_1 = require("../config/cinema");
// GET /api/config — configuration publique du cinéma
function getCinemaConfig(_req, res) {
    const response = {
        capacity: cinema_1.CINEMA_CONFIG.capacity,
        timezone: cinema_1.CINEMA_CONFIG.timezone,
        screeningSlots: cinema_1.CINEMA_CONFIG.screeningSlots,
        seatCategories: cinema_1.CINEMA_CONFIG.seatCategories,
    };
    res.json(response);
}
