const { query } = require("../src/db/db");
const { store } = require("../src/data/store");

// Legacy queue tests create users in store.js; identity now comes from PostgreSQL.
const persistTestUsers = async () => {
  for (const user of store.users.filter((user) => user.id > 6)) {
    const email = user.email || `test${user.id}@example.com`;
    await query("INSERT INTO user_credentials (id, email, password_hash, role) VALUES ($1, $2, 'test-only', 'user')", [user.id, email]);
    await query("INSERT INTO user_profiles (user_id, email, full_name) VALUES ($1, $2, $3)", [user.id, email, user.name]);
  }
};
module.exports = { persistTestUsers };