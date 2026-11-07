const express = require("express");
const { register, login } = require("./service");

const router = express.Router();

router.post("/register", async (req, res) => {
  res.status(201).json({ user: await register(req.body ?? {}) });
});

router.post("/login", async (req, res) => {
  res.json({ user: await login(req.body ?? {}) });
});

module.exports = router;
