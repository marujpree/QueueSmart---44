const { query } = require("../src/db/db");

// inserts a user with a fixed id (the seed only has ids 1-6)
const addUser = async (id, role = "user") => {
  await query("INSERT INTO user_credentials (id, email, password_hash, role) VALUES ($1, $2, 'x', $3)", [id, `test${id}@example.com`, role]);
  await query("INSERT INTO user_profiles (user_id, email, full_name) VALUES ($1, $2, $3)", [id, `test${id}@example.com`, `Test User ${id}`]);
  return id;
};

const count = async (table, where = "TRUE", params = []) =>
  (await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;

// async version of the catchError helpers the tests used to define
const catchError = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
};

module.exports = { addUser, count, catchError };
