const { query } = require("../../db/db");
const { badRequest, forbidden, notFound } = require("../../utils/httpError");

const audiences = ["admin", "user"];
const types = ["signup", "queue_update", "status_change"];
const maxTitle = 100;
const maxMessage = 300;

const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

const checkAudience = (audience) => {
  if (!audiences.includes(audience)) {
    throw badRequest("Audience must be \"admin\" or \"user\".", { audience: "Audience must be \"admin\" or \"user\"." });
  }
};

const toNotification = (row) => ({
  id: row.id,
  audience: row.audience,
  ...(row.audience === "user" && { userId: row.user_id }),
  type: row.type,
  title: row.title,
  message: row.message,
  createdAt: new Date(row.created_at).toISOString(),
  read: row.status === "viewed",
});

// admins see every admin notif, users only their own
const audienceFilter = (audience, userId) =>
  audience === "admin"
    ? { where: "audience = 'admin'", params: [] }
    : { where: "audience = 'user' AND user_id = $1", params: [userId] };

// newest first
const listNotifications = async (audience, userId) => {
  checkAudience(audience);
  const { where, params } = audienceFilter(audience, userId);
  const { rows } = await query(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC`, params);
  return rows.map(toNotification);
};

const addNotification = async ({ audience, userId, type, title, message } = {}) => {
  const fields = {};

  if (!audiences.includes(audience)) {
    fields.audience = "Audience must be \"admin\" or \"user\".";
  }

  if (audience === "user") {
    if (userId === undefined || userId === null || userId === "") {
      fields.userId = "User is required for a user notification.";
    } else {
      const id = Number(userId);
      const found = Number.isSafeInteger(id) && id > 0
        ? (await query("SELECT 1 FROM user_credentials WHERE id = $1", [id])).rowCount > 0
        : false;
      if (!found) fields.userId = "That user doesn't exist.";
    }
  }

  if (!types.includes(type)) {
    fields.type = "Type must be \"signup\", \"queue_update\" or \"status_change\".";
  }

  if (!isNonEmptyString(title)) {
    fields.title = "Title is required.";
  } else if (title.trim().length > maxTitle) {
    fields.title = `Title must be ${maxTitle} characters or less.`;
  }

  if (!isNonEmptyString(message)) {
    fields.message = "Message is required.";
  } else if (message.trim().length > maxMessage) {
    fields.message = `Message must be ${maxMessage} characters or less.`;
  }

  if (Object.keys(fields).length > 0) {
    throw badRequest("Notification is not valid.", fields);
  }

  const { rows } = await query(
    `INSERT INTO notifications (user_id, audience, type, title, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [audience === "user" ? Number(userId) : null, audience, type, title.trim(), message.trim()]
  );
  return toNotification(rows[0]);
};

const markAsRead = async (id, requester) => {
  // ids are 32-bit ints in the database
  const numericId = Number(id);
  const { rows } = numericId > 2147483647 ? { rows: [] } : await query("SELECT * FROM notifications WHERE id = $1", [numericId]);
  if (!rows.length) throw notFound("Notification not found.");

  const notification = rows[0];
  const allowed = notification.audience === "admin"
    ? requester.role === "admin"
    : notification.user_id === requester.id;
  if (!allowed) throw forbidden("You can only mark your own notifications as read.");

  const updated = await query("UPDATE notifications SET status = 'viewed' WHERE id = $1 RETURNING *", [notification.id]);
  return toNotification(updated.rows[0]);
};

// how many unread to read
const markAllAsRead = async (audience, userId) => {
  checkAudience(audience);
  const { where, params } = audienceFilter(audience, userId);
  const { rowCount } = await query(`UPDATE notifications SET status = 'viewed' WHERE ${where} AND status = 'sent'`, params);
  return rowCount;
};

// trigger helpers

const notifyJoined = (userId, serviceName, position, waitMinutes) =>
  addNotification({
    audience: "user",
    userId,
    type: "queue_update",
    title: "You joined the queue",
    message: position === 1
      ? `You're next in line for ${serviceName}.`
      : `You're #${position} in line for ${serviceName}, about ${waitMinutes} min wait.`,
  });

const notifyAlmostReady = (userId, serviceName) =>
  addNotification({
    audience: "user",
    userId,
    type: "status_change",
    title: "Almost your turn",
    message: `Head over to ${serviceName}, you're almost up.`,
  });

const notifyServed = (userId, serviceName) =>
  addNotification({
    audience: "user",
    userId,
    type: "status_change",
    title: "You've been served",
    message: `Thanks for visiting ${serviceName}.`,
  });

const notifyNewSignup = (email) =>
  addNotification({
    audience: "admin",
    type: "signup",
    title: "New user signed up",
    message: `${email} just created an account.`,
  });

const notifyRemoved = (userId, serviceName) =>
  addNotification({
    audience: "user",
    userId,
    type: "status_change",
    title: "Removed from the queue",
    message: `An admin removed you from the ${serviceName} queue.`,
  });

module.exports = {
  listNotifications,
  addNotification,
  markAsRead,
  markAllAsRead,
  notifyJoined,
  notifyAlmostReady,
  notifyServed,
  notifyNewSignup,
  notifyRemoved,
};
