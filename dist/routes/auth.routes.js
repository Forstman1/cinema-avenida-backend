"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.post("/signup", auth_controller_1.signup); // BF-01
router.post("/login", auth_controller_1.login); // BF-02
router.patch("/me", auth_1.verifyToken, auth_controller_1.updateProfile);
exports.default = router;
