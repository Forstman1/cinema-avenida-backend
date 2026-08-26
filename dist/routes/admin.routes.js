"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const admin_controller_1 = require("../controllers/admin.controller");
const router = (0, express_1.Router)();
// GET /api/admin/dashboard — indicateurs d'exploitation (admin uniquement)
router.get("/dashboard", auth_1.verifyToken, auth_1.isAdmin, admin_controller_1.getDashboard);
exports.default = router;
