"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CINEMA_CONFIG = void 0;
const cinema_config_json_1 = __importDefault(require("../../config/cinema-config.json"));
const screeningSlots = Object.freeze([...cinema_config_json_1.default.screeningSlots]);
const seatCategories = Object.freeze({
    ...cinema_config_json_1.default.seatCategories,
});
exports.CINEMA_CONFIG = Object.freeze({
    capacity: cinema_config_json_1.default.capacity,
    timezone: process.env.CINEMA_TIMEZONE?.trim() || cinema_config_json_1.default.timezone,
    screeningSlots,
    seatCategories,
});
