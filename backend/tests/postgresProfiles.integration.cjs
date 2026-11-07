// Runs a real PostgreSQL engine in-process, with a temporary on-disk database.
// No Supabase credentials or network connection are used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { migrate } = require("../src/db/migrate");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "queuesmart-profiles-"));
let db;
let server;
const query = async (sql, params) => {
  // PGlite exec accepts SQL batches, query accepts parameterized statements.
  if (!params && sql.trim().replace(/;\s*$/, "").includes(";")) return db.exec(sql);
  const result = await db.query(sql, params);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const withTransaction = async (callback) => {
  await db.exec("BEGIN");
  try {
    const result = await callback({ query });
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
};

const startApi = async () => {
  // Inject only the test database adapter; run the actual Express routes/services.
  require.cache[require.resolve("../src/db/db")] = { exports: { query, withTransaction } };
  const app = require("../src/app");
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return async (method, endpoint, body, userId) => {
    const res = await fetch(`${base}${endpoint}`, { method, headers: { "Content-Type": "application/json", ...(userId ? { "x-user-id": String(userId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
};
const stopApi = () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));

(async () => {
  db = new PGlite(directory);
  await db.exec(fs.readFileSync(path.join(__dirname, "../src/db/schema.sql"), "utf8"));
  // A pre-existing row demonstrates that migrations keep data and are repeatable.
  await query("INSERT INTO user_credentials (email, password_hash) VALUES ('existing@example.com', 'x')");
  await query("INSERT INTO user_profiles (user_id, email, full_name) VALUES (1, 'existing@example.com', 'Existing Person')");
  await withTransaction(migrate);
  await withTransaction(migrate);
  assert.equal((await query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 1);
  assert.equal((await query("SELECT full_name FROM user_profiles WHERE user_id = 1")).rows[0].full_name, "Existing Person");

  let api = await startApi();
  const account = { firstName: "Persisted", lastName: "Person", email: "persisted@example.com", phone: "713-555-1234", password: "Password1" };
  const created = await api("POST", "/auth/register", account);
  assert.equal(created.status, 201);
  const id = created.body.user.id;
  assert.equal((await api("PATCH", "/profiles/me", { fullName: "Saved After Restart", preferences: { contactMethod: "phone" } }, id)).status, 200);
  assert.equal((await api("POST", "/auth/register", { ...account, email: "PERSISTED@example.com" })).status, 409);

  // Test the actual PostgreSQL composite foreign key cascade and identity pairing.
  await query("UPDATE user_credentials SET email = 'renamed@example.com' WHERE id = $1", [id]);
  assert.equal((await api("GET", "/profiles/me", undefined, id)).body.profile.email, "renamed@example.com");
  await query("DELETE FROM user_profiles WHERE user_id = 1");
  await assert.rejects(query("UPDATE user_profiles SET email = 'existing@example.com' WHERE user_id = $1", [id]));
  for (const [sql, params] of [
    ["UPDATE user_profiles SET full_name = '' WHERE user_id = $1", [id]],
    ["UPDATE user_profiles SET full_name = $1 WHERE user_id = $2", ["A".repeat(101), id]],
    ["UPDATE user_profiles SET phone = 'abc' WHERE user_id = $1", [id]],
    ["UPDATE user_profiles SET preferences = '[]'::jsonb WHERE user_id = $1", [id]],
    ["UPDATE user_profiles SET preferences = '{\"contactMethod\":42}'::jsonb WHERE user_id = $1", [id]],
    ["UPDATE user_profiles SET phone = NULL WHERE user_id = $1", [id]],
    ["INSERT INTO user_credentials (email, password_hash) VALUES ('RENAMED@example.com', 'x')", []],
  ]) await assert.rejects(query(sql, params));

  await stopApi(); server = null;
  await db.close();
  db = new PGlite(directory);
  require("../src/data/store").resetStore();
  api = await startApi();
  const login = await api("POST", "/auth/login", { email: "renamed@example.com", password: account.password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, id);
  const loaded = await api("GET", "/profiles/me", undefined, id);
  assert.equal(loaded.body.profile.fullName, "Saved After Restart");
  assert.deepEqual(loaded.body.profile.preferences, { contactMethod: "phone" });
  console.log("PostgreSQL integration passed: migrations repeat safely, constraints and cascades work, profile APIs persist across database/API restart.");
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (server) await stopApi();
  if (db) await db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
