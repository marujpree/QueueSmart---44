const bcrypt = require("bcryptjs");
const { query, withTransaction } = require("../../db/db");
const { badRequest, conflict, unauthorized } = require("../../utils/httpError");
const { validateRegister, validateLogin } = require("./validation");
const { notifyNewSignup } = require("../notifications/notificationService");

const BCRYPT_ROUNDS = 10;
// user_profiles.full_name is varchar(100)
const FULL_NAME_MAX = 100;

const normalizeEmail = (email) => email.trim().toLowerCase();

// user_credentials joined with user_profiles, same columns every time
const USER_SELECT = `
  SELECT c.id, c.email, c.role, c.password_hash, p.full_name, p.phone, p.preferences
  FROM user_credentials c
  LEFT JOIN user_profiles p ON p.user_id = c.id`;

// the profile only stores full_name, so register keeps the split in preferences
const splitName = (row) => {
  const { firstName, lastName } = row.preferences ?? {};
  if (firstName !== undefined) return { firstName, lastName: lastName ?? "" };
  const [first = "", ...rest] = (row.full_name ?? "").split(" ");
  return { firstName: first, lastName: rest.join(" ") };
};

// never send the password hash to the client
const publicUser = (row) => ({
  id: row.id,
  name: row.full_name ?? "",
  ...splitName(row),
  email: row.email,
  phone: row.phone ?? "",
  role: row.role,
});

const findByEmail = async (email) => {
  const { rows } = await query(`${USER_SELECT} WHERE c.email = $1`, [normalizeEmail(email)]);
  return rows[0] ?? null;
};

const findById = async (id) => {
  const { rows } = await query(`${USER_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
};

const register = async (body) => {
  const fields = validateRegister(body);
  if (Object.keys(fields).length) throw badRequest("Please fix the highlighted fields.", fields);

  const email = normalizeEmail(body.email);
  if (await findByEmail(email)) throw conflict("An account with that email already exists.");

  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  const fullName = `${firstName} ${lastName}`;
  if (fullName.length > FULL_NAME_MAX) {
    const message = `First and last name together must be ${FULL_NAME_MAX} characters or fewer.`;
    throw badRequest("Please fix the highlighted fields.", { lastName: message });
  }

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

  let id;
  try {
    id = await withTransaction(async (client) => {
      // role is never taken from the request, new accounts are always regular users
      const created = await client.query(
        "INSERT INTO user_credentials (email, password_hash, role) VALUES ($1, $2, 'user') RETURNING id",
        [email, passwordHash]
      );
      const userId = created.rows[0].id;
      await client.query(
        "INSERT INTO user_profiles (user_id, email, full_name, phone, preferences) VALUES ($1, $2, $3, $4, $5)",
        [userId, email, fullName, body.phone?.trim() || null, JSON.stringify({ firstName, lastName })]
      );
      return userId;
    });
  } catch (err) {
    // two people registering the same email at once
    if (err.code === "23505") throw conflict("An account with that email already exists.");
    throw err;
  }

  // the account exists either way, so a failed notification shouldn't fail the sign up
  try {
    await notifyNewSignup(email);
  } catch (err) {
    console.error("Could not create the signup notification:", err.message);
  }

  return publicUser(await findById(id));
};

let dummyHash;

const login = async (body) => {
  const fields = validateLogin(body);
  if (Object.keys(fields).length) throw badRequest("Please fix the highlighted fields.", fields);

  const user = await findByEmail(body.email);
  // compare against a throwaway hash for unknown emails so both cases take about as long
  dummyHash ??= bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);
  const matches = await bcrypt.compare(body.password, user ? user.password_hash : dummyHash);

  // same message for unknown email and wrong password so emails can't be probed
  if (!user || !matches) throw unauthorized("Invalid email or password.");
  return publicUser(user);
};

module.exports = { register, login, publicUser, findById };
