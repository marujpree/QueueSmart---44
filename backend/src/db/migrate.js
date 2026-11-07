const fs = require("fs");
const path = require("path");
const migrationsDir = path.join(__dirname, "migrations");
const migrations = () => fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
const readMigration = (name) => fs.readFileSync(path.join(migrationsDir, name), "utf8");

// Call on a single transaction client lock serializes other runs.
const migrate = async (client) => {
  await client.query("SELECT pg_advisory_xact_lock(7342101)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(200) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of migrations()) {
    const { rows } = await client.query("SELECT name FROM schema_migrations WHERE name = $1", [name]);
    if (rows.length) continue;
    await client.query(readMigration(name));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
  }
};
module.exports = { migrate, migrations, readMigration };
