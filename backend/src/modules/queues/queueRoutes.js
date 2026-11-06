const express = require("express");
const { requireUser, requireAdmin } = require("../../middleware/currentUser");
const { getMyEntry, joinQueue, leaveQueue, getQueueSummary } = require("./queueService");
const { getQueueDetails, serveNext, removeEntry, setPriority, moveEntry } = require("./adminQueueService");

const router = express.Router();

router.get("/me", requireUser, (req, res) => {
  res.json(getMyEntry(req.user.id) || { entry: null });
});

router.post("/join", requireUser, async (req, res) => {
  res.status(201).json(await joinQueue(req.user.id, req.body));
});

router.post("/leave", requireUser, async (req, res) => {
  res.json(await leaveQueue(req.user.id));
});

// public so the join page can show waits before signing in
router.get("/:serviceId/summary", (req, res) => {
  res.json(getQueueSummary(req.params.serviceId));
});

router.get("/:serviceId/entries", requireAdmin, (req, res) => {
  res.json(getQueueDetails(req.params.serviceId));
});

router.post("/:serviceId/serve-next", requireAdmin, async (req, res) => {
  res.json(await serveNext(req.params.serviceId));
});

router.delete("/:serviceId/entries/:entryId", requireAdmin, async (req, res) => {
  res.json(await removeEntry(req.params.serviceId, req.params.entryId));
});

router.patch("/:serviceId/entries/:entryId", requireAdmin, (req, res) => {
  res.json(setPriority(req.params.serviceId, req.params.entryId, req.body?.priority));
});

router.post("/:serviceId/entries/:entryId/move", requireAdmin, (req, res) => {
  res.json(moveEntry(req.params.serviceId, req.params.entryId, req.body?.direction));
});
module.exports = router;
