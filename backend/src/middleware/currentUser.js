const { query } = require("../db/db");
const { unauthorized, forbidden } = require("../utils/httpError");

// reads x-user-id and sets req.user to that user, or null if missing or unknown
const currentUser = async (req, res, next) => {
  try {
    const id = Number(req.get("x-user-id"));
    req.user = null;
    if (Number.isSafeInteger(id) && id > 0) {
      const { rows } = await query(
        `SELECT c.id, c.email, c.role, p.full_name AS name
         FROM user_credentials c LEFT JOIN user_profiles p ON p.user_id = c.id
         WHERE c.id = $1`,
        [id]
      );
      req.user = rows[0] ?? null;
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
