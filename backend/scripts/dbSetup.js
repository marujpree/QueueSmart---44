// npm run db:setup          create tables, seed only if empty (safe to run twice)
// npm run db:reset -- --yes drop every table, then run setup again
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const isReset = process.argv.includes("--reset");
const confirmed = process.argv.includes("--yes");

const dropSql = `
  DROP TABLE IF EXISTS queue_history, notifications, queue_entries, queues, services, user_profiles, user_credentials CASCADE;
  DROP SEQUENCE IF EXISTS queue_history_id_seq, notifications_id_seq, queue_entries_id_seq, queues_id_seq, services_id_seq, user_credentials_id_seq;
`;

const main = async () => {
  if (isReset) {
    console.warn("WARNING: db:reset wipes the SHARED team database on Supabase. Everyone's data will be lost.");
    if (!confirmed) {
      console.error("Refusing to reset. Run \"npm run db:reset -- --yes\" if you really mean it.");
      process.exitCode = 1;
      return;
    }
  }

  const { query, withTransaction, closeDb } = require("../src/db/db");
  const { seed } = require("../src/db/seed");

  try {
    if (isReset) {
      await query(dropSql);
      console.log("Dropped all tables.");
    }

    await query(fs.readFileSync(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8"));
    console.log("Schema is up to date.");
    const { migrate } = require("../src/db/migrate");
    await withTransaction(migrate);
    console.log("Schema and migrations are up to date.");

    const { rows } = await query("SELECT COUNT(*)::int AS count FROM user_credentials");
    if (rows[0].count === 0) {
      await withTransaction((client) => seed((text, params) => client.query(text, params)));
      console.log("Seeded demo data.");
    } else {
      console.log(`Skipped seeding, user_credentials already has ${rows[0].count} rows.`);
    }
  } finally {
    await closeDb();
  }
};

main().catch((err) => {
  console.error("Database setup failed:", err.message);
  process.exitCode = 1;
});