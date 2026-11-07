const express = require("express");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

router.use("/profiles", require("../modules/profiles/routes"));

router.use("/auth", require("../modules/auth/routes"));

router.use("/services", require("../modules/services/routes"));

router.use("/notifications", require("../modules/notifications/notificationRoutes"));

router.use("/queues", require("../modules/queues/queueRoutes"));
// to do: mount admin queue router on /queues here

router.use("/history", require("../modules/history/historyRoutes"));

module.exports = router;
