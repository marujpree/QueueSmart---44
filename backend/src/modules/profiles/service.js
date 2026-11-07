const { query } = require("../../db/db");
const { badRequest, notFound } = require("../../utils/httpError");
const { validateProfile } = require("./validation");

const toProfile = (row) => ({
  userId: row.user_id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  preferences: row.preferences,
});

const getProfile = async (userId) => {
  const { rows } = await query("SELECT * FROM user_profiles WHERE user_id = $1", [userId]);
  if (!rows[0]) throw notFound("Profile not found.");
  return toProfile(rows[0]);
};

const updateProfile = async (userId, body) => {
  const fields = validateProfile(body);
  if (Object.keys(fields).length) throw badRequest("Please fix the highlighted fields.", fields);

  if (Object.hasOwn(body, "phone") || Object.hasOwn(body, "preferences")) {
    const current = await getProfile(userId);
    const phone = Object.hasOwn(body, "phone") ? body.phone?.trim() || null : current.phone;
    const preferences = body.preferences || current.preferences;
    if (preferences.contactMethod === "phone" && !phone) {
      throw badRequest("Please fix the highlighted fields.", { phone: "Add a phone number before choosing phone as your preferred contact method." });
    }
  }

  // Update supplied columns only parallel edits to different fields are kept
  const columns = [];
  const params = [userId];
  for (const [key, column] of [["fullName", "full_name"], ["phone", "phone"], ["preferences", "preferences"]]) {
    if (!Object.hasOwn(body, key)) continue;
    const value = key === "preferences" ? JSON.stringify(body[key]) : key === "phone" ? body[key]?.trim() || null : body[key].trim();
    params.push(value);
    columns.push(`${column} = $${params.length}`);
  }
  try {
    const { rows } = await query(`UPDATE user_profiles SET ${columns.join(", ")} WHERE user_id = $1 RETURNING *`, params);
    if (!rows[0]) throw notFound("Profile not found.");
    return toProfile(rows[0]);
  } catch (err) {
    if (err.code === "23514" && err.constraint === "user_profiles_contact_phone_check") {
      throw badRequest("Please fix the highlighted fields.", { phone: "Add a phone number before choosing phone as your preferred contact method." });
    }
    throw err;
  }
};

module.exports = { toProfile, getProfile, updateProfile };
