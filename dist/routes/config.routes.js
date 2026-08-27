"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_controller_1 = require("../controllers/config.controller");
const router = (0, express_1.Router)();
router.get("/", config_controller_1.getCinemaConfig);
exports.default = router;
