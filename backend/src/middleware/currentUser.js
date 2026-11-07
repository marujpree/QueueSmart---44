const { findUserById } = require("../modules/auth/service");
const { store } = require("../data/store");
const { unauthorized, forbidden } = require("../utils/httpError");

// reads x-user-id and sets req.user to that user, or null if missing or unknown
const currentUser = async (req, res, next) => {
  try {
    const raw = req.get("x-user-id");
    const id = typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
    req.user = Number.isSafeInteger(id) && id <= 2147483647 ? await findUserById(id) : null;
    // Temporary adapter for queue/notification modules still using store.users.
    // Database profiles are authoritative; this public snapshot is refreshed per request.
    if (req.user) {
      const index = store.users.findIndex((user) => user.id === id);
      if (index < 0) store.users.push({ ...req.user });
      else store.users[index] = { ...req.user };
    }
    next();
  } catch (err) {
    next(err);
  }
};

const requireUser = (req, res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden("Only admins can do this."));
  next();
};

module.exports = { currentUser, requireUser, requireAdmin };