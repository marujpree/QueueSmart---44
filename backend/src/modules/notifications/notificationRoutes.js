const express = require("express");
const { requireUser, requireAdmin } = require("../../middleware/currentUser");
const { badRequest } = require("../../utils/httpError");
const { listNotifications, markAsRead, markAllAsRead } = require("./notificationService");

const router = express.Router();

router.use(requireUser);

// ?audience=user|admin
const checkAudience = (req, res, next) => {
  const { audience } = req.query;
  if (audience !== "user" && audience !== "admin") {
    return next(badRequest("Audience must be \"user\" or \"admin\".", { audience: "Audience must be \"user\" or \"admin\"." }));
  }
  if (audience === "admin") return requireAdmin(req, res, next);
  next();
};

router.get("/", checkAudience, async (req, res) => {
  res.json({ notifications: await listNotifications(req.query.audience, req.user.id) });
});

router.patch("/read-all", checkAudience, async (req, res) => {
  res.json({ updated: await markAllAsRead(req.query.audience, req.user.id) });
});

router.patch("/:id/read", async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id)) {
    throw badRequest("Notification id must be a positive integer.");
  }
  res.json({ notification: await markAsRead(req.params.id, req.user) });
});

module.exports = router;
