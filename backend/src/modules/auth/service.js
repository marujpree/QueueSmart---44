const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../../db/db");
const { badRequest, conflict, unauthorized } = require("../../utils/httpError");
const { validateRegister, validateLogin } = require("./validation");
const { validateFullName, validatePreferences, isObject } = require("../profiles/validation");
const { notifyNewSignup } = require("../notifications/notificationService");

// never send the password to the client
const userSelect = `SELECT c.id, c.email, c.role, p.full_name, p.phone, p.preferences
  FROM user_credentials c JOIN user_profiles p ON p.user_id = c.id`;
const publicUser = (row) => ({
  id: row.id,
  name: row.full_name,
  email: row.email,
  phone: row.phone || "",
  preferences: row.preferences,
  role: row.role,
});
const findUserById = async (id) => {
  const { rows } = await query(`${userSelect} WHERE c.id = $1`, [id]);
  return rows[0] ? publicUser(rows[0]) : null;
};

const register = async (body) => {
  if (!isObject(body)) throw badRequest("Send an account object.");
  const fields = validateRegister(body);
  if (!fields.firstName && !fields.lastName) {
    const nameError = validateFullName(`${body.firstName.trim()} ${body.lastName.trim()}`);
    if (nameError) fields.firstName = nameError;
  }
  if (body.preferences !== undefined) fields.preferences = validatePreferences(body.preferences);
  if (body.preferences?.contactMethod === "phone" && !body.phone?.trim?.()) fields.phone = "Add a phone number before choosing phone as your preferred contact method.";
  const errors = Object.fromEntries(Object.entries(fields).filter(([, message]) => message));
  if (Object.keys(errors).length) throw badRequest("Please fix the highlighted fields.", errors);

  const email = body.email.trim().toLowerCase();
  const hash = await bcrypt.hash(body.password, 10);
  let user;
  try {
    user = await withTransaction(async (client) => {
      // The role is assigned here; a caller cannot register as an admin.
      const { rows } = await client.query("INSERT INTO user_credentials (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id", [email, hash]);
      const id = rows[0].id;
      await client.query("INSERT INTO user_profiles (user_id, email, full_name, phone, preferences) VALUES ($1, $2, $3, $4, $5)",
        [id, email, `${body.firstName.trim()} ${body.lastName.trim()}`, body.phone?.trim() || null, JSON.stringify(body.preferences || {})]);
      return { id, name: `${body.firstName.trim()} ${body.lastName.trim()}`, email, phone: body.phone?.trim() || "", preferences: body.preferences || {}, role: "user" };
    });
  } catch (err) {
    if (err.code === "23505") throw conflict("An account with that email already exists.");
    throw err;
  }
  // the account exists either way, so a failed notification shouldn't fail the sign up
  try {
    await notifyNewSignup(user.email);
  } catch (err) {
    console.error("Could not create the signup notification:", err.message);
  }
  return user;
};

const login = async (body) => {
  if (!isObject(body)) throw badRequest("Send an account object.");
  const fields = validateLogin(body);
  if (Object.keys(fields).length) throw badRequest("Please fix the highlighted fields.", fields);
  const { rows } = await query("SELECT id, password_hash FROM user_credentials WHERE lower(email) = $1", [body.email.trim().toLowerCase()]);
  const credential = rows[0];
  if (!credential || !(await bcrypt.compare(body.password, credential.password_hash))) throw unauthorized("Invalid email or password.");
  const user = await findUserById(credential.id);
  if (!user) throw unauthorized("Invalid email or password.");
  return user;
};
module.exports = { register, login, publicUser, findUserById };