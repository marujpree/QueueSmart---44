const express = require("express");
const { requireUser } = require("../../middleware/currentUser");
const { getProfile, updateProfile } = require("./service");

const router = express.Router();
router.use(requireUser);
router.get("/me", async (req, res) => {
  res.json({ profile: await getProfile(req.user.id) });
});
router.patch("/me", async (req, res) => {
  res.json({ profile: await updateProfile(req.user.id, req.body) });
});
module.exports = router;
