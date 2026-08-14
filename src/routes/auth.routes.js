const express = require("express");
const router = express.Router();
const { signup, login } = require("../controllers/auth.controller");

router.post("/signup", signup); // BF-01
router.post("/login", login);   // BF-02

module.exports = router;
