const { query } = require("../../db/db");

const toHistory = (row) => ({
  id: row.id,
  userId: row.user_id,
  serviceId: row.service_id,
  serviceName: row.service_name,
  outcome: row.outcome,
  entryId: row.entry_id,
  date: new Date(row.created_at).toISOString(),
});

// one row per queue entry, so a later outcome (Waiting -> Served) updates it
const addHistory = async ({ userId, serviceId, serviceName, outcome, entryId }) => {
  if (entryId !== undefined && entryId !== null) {
    const { rows } = await query(
      "UPDATE queue_history SET outcome = $1, created_at = now() WHERE entry_id = $2 RETURNING *",
      [outcome, entryId]
    );
    if (rows.length) return toHistory(rows[0]);
  }

  const { rows } = await query(
    `INSERT INTO queue_history (user_id, service_id, service_name, outcome, entry_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, serviceId ?? null, serviceName, outcome, entryId ?? null]
  );
  return toHistory(rows[0]);
};

// newest first
const getHistory = async (userId) => {
  const { rows } = await query(
    "SELECT * FROM queue_history WHERE user_id = $1 ORDER BY created_at DESC, id DESC",
    [userId]
  );
  return rows.map(toHistory);
};

module.exports = { addHistory, getHistory };
