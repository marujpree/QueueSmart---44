const express = require("express");
const { requireUser } = require("../../middleware/currentUser");
const { getHistory } = require("./historyService");

const router = express.Router();

router.use(requireUser);

router.get("/", async (req, res) => {
  res.json({ history: await getHistory(req.user.id) });
});

module.exports = router;
