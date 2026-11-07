const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { withTransaction, closeDb } = require("../src/db/db");
const { migrate } = require("../src/db/migrate");

withTransaction(migrate)
  .then(() => console.log("Database migrations applied. Existing data was kept."))
  .catch((err) => { console.error("Migration failed:", err.message); process.exitCode = 1; })
  .finally(() => closeDb());