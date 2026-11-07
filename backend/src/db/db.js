const fs = require("fs");
const path = require("path");
const { seed } = require("./seed");

const isTest = process.env.NODE_ENV === "test";
const schemaPath = path.join(__dirname, "schema.sql");

let pool;
let memDb;
let emptyBackup;
let seededBackup;

if (isTest) {
  const { newDb } = require("pg-mem");
  memDb = newDb();
  memDb.public.none(fs.readFileSync(schemaPath, "utf8"));
  const { migrations, readMigration } = require("./migrate");
  memDb.public.registerFunction({ name: "regexp_replace", args: ["text", "text", "text", "text"], returns: "text",
    implementation: (value, pattern, replacement, flags) => value.replace(new RegExp(pattern, flags), replacement) });
  memDb.public.registerFunction({ name: "trim", args: ["text"], returns: "text", implementation: (value) => value.trim() });
  memDb.public.registerFunction({ name: "length", args: ["text"], returns: "integer", implementation: (value) => [...value].length });
  // pg-mem lacks PostgreSQL's POSIX regex operator; adapt only in test mode.
  memDb.public.registerOperator({ operator: "~", left: "text", right: "text", returns: "bool",
    implementation: (value, pattern) => new RegExp(pattern.replaceAll("[:space:]", "\\s")).test(value) });
  for (const name of migrations()) memDb.public.none(readMigration(name));
  emptyBackup = memDb.backup();
  const { Pool } = memDb.adapters.createPg();
  pool = new Pool();
} else {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in (see backend/DATABASE.md).");
  }
  const { Pool } = require("pg");
  // supabase requires ssl
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const query = async (text, params) => {
  const { rows, rowCount } = await pool.query(text, params);
  return { rows, rowCount };
};

const withTransaction = async (callback) => {
  const client = await pool.connect();
  const snapshot = isTest ? memDb.backup() : null;
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    if (snapshot) snapshot.restore();
    throw err;
  } finally {
    client.release();
  }
};

const resetTestDb = async () => {
  if (!isTest) throw new Error("resetTestDb only runs when NODE_ENV is \"test\".");
  if (seededBackup) {
    seededBackup.restore();
  } else {
    emptyBackup.restore();
    await seed(query);
    seededBackup = memDb.backup();
  }
};

const closeDb = () => pool.end();

module.exports = { query, withTransaction, resetTestDb, closeDb };