const db = require("../../db/db");
const { badRequest, notFound, conflict } = require("../../utils/httpError");
const { estimateWait } = require("../waitTime/waitTimeService");
const { addHistory } = require("../history/historyService");
const { notifyJoined } = require("../notifications/notificationService");

const priorities = ["low", "medium", "high"];
const sameOrHigher = { high: ["high"], medium: ["high", "medium"], low: ["high", "medium", "low"] };

const getStatus = (position) => (position <= 2 ? "almost ready" : "waiting");

const entrySelect = `
  SELECT e.id, e.queue_id, e.user_id, p.full_name, p.email, q.service_id, s.name AS service_name,
    s.duration_minutes, e.priority, e.status, e.join_time, e.position
  FROM queue_entries e
  JOIN queues q ON q.id = e.queue_id
  JOIN services s ON s.id = q.service_id
  LEFT JOIN user_profiles p ON p.user_id = e.user_id`;

const toEntry = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.full_name,
  email: row.email,
  serviceId: row.service_id,
  priority: row.priority,
  status: row.status,
  joinedAt: new Date(row.join_time).toISOString(),
  position: row.position,
});

const describe = (row) => ({
  entry: toEntry(row),
  serviceName: row.service_name,
  position: row.position,
  waitMinutes: estimateWait(row.position, row.duration_minutes),
  status: getStatus(row.position),
});

const toHttpError = (err) => {
  if (err.code === "23505") return conflict("You're already in a queue.");
  if (err.code === "23503") return notFound("That user or service doesn't exist.");
  return err;
};

const toId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const findQueue = async (run, serviceId, { lock = false } = {}) => {
  const id = toId(serviceId);
  if (!id) throw notFound("Service not found.");
  const { rows } = await run(
    `SELECT q.id, q.service_id, q.status, s.name, s.duration_minutes
     FROM queues q JOIN services s ON s.id = q.service_id
     WHERE q.service_id = $1${lock ? " FOR UPDATE" : ""}`,
    [id]
  );
  if (!rows[0]) throw notFound("Service not found.");
  return rows[0];
};

const findWaitingRow = async (run, userId) =>
  (await run(`${entrySelect} WHERE e.user_id = $1 AND e.status = 'waiting'`, [userId])).rows[0];

const getQueue = async (serviceId) => {
  const id = toId(serviceId);
  if (!id) return [];
  const { rows } = await db.query(`${entrySelect} WHERE q.service_id = $1 AND e.status = 'waiting' ORDER BY e.position, e.id`, [id]);
  return rows.map(toEntry);
};

const describeEntry = async (entry) => {
  const { rows } = await db.query("SELECT name, duration_minutes FROM services WHERE id = $1", [entry.serviceId]);
  return {
    entry,
    serviceName: rows[0].name,
    position: entry.position,
    waitMinutes: estimateWait(entry.position, rows[0].duration_minutes),
    status: getStatus(entry.position),
  };
};

const getMyEntry = async (userId) => {
  const row = await findWaitingRow(db.query, userId);
  return row ? describe(row) : null;
};

const isPositiveInteger = (value) =>
  (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
  (typeof value === "string" && /^[1-9]\d*$/.test(value));

const joinQueue = async (userId, { serviceId, priority } = {}) => {
  const fields = {};

  if (serviceId === undefined || serviceId === null || serviceId === "") {
    fields.serviceId = "Pick a service.";
  } else if (!isPositiveInteger(serviceId)) {
    fields.serviceId = "Service id must be a positive integer.";
  }

  const chosenPriority = priority === undefined || priority === null ? "medium" : priority;
  if (!priorities.includes(chosenPriority)) {
    fields.priority = "Priority must be \"low\", \"medium\" or \"high\".";
  }

  if (Object.keys(fields).length > 0) {
    throw badRequest("Couldn't join the queue.", fields);
  }

  let row;
  try {
    row = await db.withTransaction(async (client) => {
      const run = (text, params) => client.query(text, params);

      // locking queue row makes joins and leaves on one queue take turns
      const queue = await findQueue(run, serviceId, { lock: true });
      if (queue.status !== "open") throw conflict("This service is closed.");
      if (await findWaitingRow(run, userId)) throw conflict("You're already in a queue.");

      const user = await run("SELECT 1 FROM user_profiles WHERE user_id = $1", [userId]);
      if (user.rowCount === 0) throw notFound("User not found.");

      const { rows: [{ last }] } = await run(
        "SELECT COALESCE(MAX(position), 0)::int AS last FROM queue_entries WHERE queue_id = $1 AND status = 'waiting' AND priority = ANY($2)",
        [queue.id, sameOrHigher[chosenPriority]]
      );
      const position = last + 1;

      await run(
        "UPDATE queue_entries SET position = position + 1, updated_at = now() WHERE queue_id = $1 AND status = 'waiting' AND position >= $2",
        [queue.id, position]
      );
      const { rows: [{ id }] } = await run(
        "INSERT INTO queue_entries (queue_id, user_id, position, priority) VALUES ($1, $2, $3, $4) RETURNING id",
        [queue.id, userId, position, chosenPriority]
      );
      return (await run(`${entrySelect} WHERE e.id = $1`, [id])).rows[0];
    });
  } catch (err) {
    throw toHttpError(err);
  }

  const result = describe(row);
  await addHistory({ userId, serviceId: row.service_id, serviceName: row.service_name, outcome: "Waiting", entryId: row.id });
  await notifyJoined(userId, row.service_name, result.position, result.waitMinutes);
  return result;
};

const leaveQueue = async (userId) => {
  const row = await db.withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);

    const waiting = await findWaitingRow(run, userId);
    if (!waiting) throw notFound("You're not in a queue.");
    await run("SELECT id FROM queues WHERE id = $1 FOR UPDATE", [waiting.queue_id]);

    // re-check after lock
    const canceled = await run(
      "UPDATE queue_entries SET status = 'canceled', updated_at = now() WHERE id = $1 AND status = 'waiting' RETURNING position",
      [waiting.id]
    );
    if (canceled.rowCount === 0) throw notFound("You're not in a queue.");

    await run(
      "UPDATE queue_entries SET position = position - 1, updated_at = now() WHERE queue_id = $1 AND status = 'waiting' AND position > $2",
      [waiting.queue_id, canceled.rows[0].position]
    );
    return waiting;
  });

  await addHistory({ userId, serviceId: row.service_id, serviceName: row.service_name, outcome: "Left queue", entryId: row.id });
  return { left: true, serviceName: row.service_name };
};

const getQueueSummary = async (serviceId) => {
  const queue = await findQueue(db.query, serviceId);
  const { rows: [{ waiting }] } = await db.query(
    "SELECT COUNT(*)::int AS waiting FROM queue_entries WHERE queue_id = $1 AND status = 'waiting'",
    [queue.id]
  );
  return {
    serviceId: queue.service_id,
    waiting,
    estimatedWaitMinutes: estimateWait(waiting + 1, queue.duration_minutes),
  };
};

module.exports = {
  priorities, getQueue, getStatus, describeEntry, getMyEntry, joinQueue, leaveQueue, getQueueSummary,
  // shared with adminQueueService
  entrySelect, toEntry, toId, findQueue,
};

for (const name of ["getQueueDetails", "serveNext", "removeEntry", "setPriority", "moveEntry"]) {
  Object.defineProperty(module.exports, name, {
    enumerable: true,
    get: () => require("./adminQueueService")[name],
  });
}
