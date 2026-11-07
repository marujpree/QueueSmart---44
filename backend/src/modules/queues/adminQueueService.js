const db = require("../../db/db");
const { badRequest, notFound, conflict } = require("../../utils/httpError");
const { getService } = require("../services/service");
const { addHistory } = require("../history/historyService");
const { notifyServed, notifyAlmostReady, notifyRemoved } = require("../notifications/notificationService");
const { priorities, getQueue, describeEntry, getQueueSummary, entrySelect, toEntry, toId, findQueue } = require("./queueService");

const priorityRank = { high: 0, medium: 1, low: 2 };

const getQueueDetails = async (serviceId) => {
  const service = await getService(serviceId);
  const entries = await getQueue(service.id);
  return {
    ...(await getQueueSummary(service.id)),
    entries: await Promise.all(entries.map(describeEntry)),
  };
};

// runs fn inside a transaction with the service's queue row locked, so admin changes and joins take turns
const inLockedQueue = (serviceId, fn) =>
  db.withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);
    const queue = await findQueue(run, serviceId, { lock: true });
    return fn(run, queue);
  });

const waitingLine = async (run, queueId) =>
  (await run(`${entrySelect} WHERE e.queue_id = $1 AND e.status = 'waiting' ORDER BY e.position, e.id`, [queueId])).rows;

// the waiting entry with this id in this queue, or a 404
const findWaitingEntry = async (run, queue, entryId) => {
  const id = toId(entryId);
  const row = id && (await run(`${entrySelect} WHERE e.id = $1 AND e.queue_id = $2 AND e.status = 'waiting'`, [id, queue.id])).rows[0];
  if (!row) throw notFound("That person isn't waiting in this queue.");
  return row;
};

// positions of the waiting entries become 1..n in the order given
const writePositions = async (run, entryIds) => {
  for (const [index, id] of entryIds.entries()) {
    await run("UPDATE queue_entries SET position = $1, updated_at = now() WHERE id = $2 AND position <> $1", [index + 1, id]);
  }
};

// close the gap left by an entry that is no longer waiting
const closeGap = (run, queueId, position) =>
  run(
    "UPDATE queue_entries SET position = position - 1, updated_at = now() WHERE queue_id = $1 AND status = 'waiting' AND position > $2",
    [queueId, position]
  );

// the first two waiting people are told once; the notifications table remembers who already was
const notifyAlmostReadyOnce = async (queueId, serviceName) => {
  const front = (await waitingLine(db.query, queueId)).slice(0, 2);
  for (const row of front) {
    const already = await db.query(
      "SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Almost your turn' AND created_at >= $2",
      [row.user_id, row.join_time]
    );
    if (already.rowCount === 0) await notifyAlmostReady(row.user_id, serviceName);
  }
};

// admin advances the queue: the person at the front is marked served
const serveNext = async (serviceId) => {
  const service = await getService(serviceId);

  const { served, servedAt, queueId } = await inLockedQueue(service.id, async (run, queue) => {
    const [front] = await waitingLine(run, queue.id);
    if (!front) throw conflict("No one waiting for this service.");
    const { rows } = await run(
      "UPDATE queue_entries SET status = 'served', updated_at = now() WHERE id = $1 RETURNING updated_at",
      [front.id]
    );
    await closeGap(run, queue.id, front.position);
    return { served: front, servedAt: new Date(rows[0].updated_at).toISOString(), queueId: queue.id };
  });

  await addHistory({ userId: served.user_id, serviceId: service.id, serviceName: service.name, outcome: "Served", entryId: served.id });
  await notifyServed(served.user_id, service.name);
  await notifyAlmostReadyOnce(queueId, service.name);

  const servedEntry = { ...toEntry(served), status: "served", servedAt };
  return { servedEntry, ...(await getQueueDetails(service.id)) };
};

// admin takes someone out of the line; their row stays as canceled
const removeEntry = async (serviceId, entryId) => {
  const service = await getService(serviceId);

  const removed = await inLockedQueue(service.id, async (run, queue) => {
    const entry = await findWaitingEntry(run, queue, entryId);
    await run("UPDATE queue_entries SET status = 'canceled', updated_at = now() WHERE id = $1", [entry.id]);
    await closeGap(run, queue.id, entry.position);
    return entry;
  });

  await addHistory({ userId: removed.user_id, serviceId: service.id, serviceName: service.name, outcome: "Removed by admin", entryId: removed.id });
  await notifyRemoved(removed.user_id, service.name);
  return getQueueDetails(service.id);
};

const setPriority = async (serviceId, entryId, priority) => {
  if (!priorities.includes(priority)) {
    throw badRequest("Priority must be \"low\", \"medium\" or \"high\".", {
      priority: "Priority must be \"low\", \"medium\" or \"high\".",
    });
  }
  const service = await getService(serviceId);

  await inLockedQueue(service.id, async (run, queue) => {
    const entry = await findWaitingEntry(run, queue, entryId);
    await run("UPDATE queue_entries SET priority = $1, updated_at = now() WHERE id = $2", [priority, entry.id]);

    // goes behind everyone ranked higher, and behind same-priority people who joined earlier
    const others = (await waitingLine(run, queue.id)).filter((row) => row.id !== entry.id);
    const ahead = others.filter(
      (row) => priorityRank[row.priority] < priorityRank[priority] ||
        (row.priority === priority && new Date(row.join_time) <= new Date(entry.join_time))
    ).length;
    const order = others.map((row) => row.id);
    order.splice(ahead, 0, entry.id);
    await writePositions(run, order);
  });
  return getQueueDetails(service.id);
};

// swaps with the neighbour; takes on the neighbour's priority so the order sticks
const moveEntry = async (serviceId, entryId, direction) => {
  if (direction !== "up" && direction !== "down") {
    throw badRequest("Direction must be \"up\" or \"down\".", { direction: "Direction must be \"up\" or \"down\"." });
  }
  const service = await getService(serviceId);

  await inLockedQueue(service.id, async (run, queue) => {
    const entry = await findWaitingEntry(run, queue, entryId);
    const line = await waitingLine(run, queue.id);
    const index = line.findIndex((row) => row.id === entry.id);
    const target = index + (direction === "up" ? -1 : 1);
    if (target < 0) throw conflict("That person is already at the front of the line.");
    if (target >= line.length) throw conflict("That person is already at the end of the line.");

    await run("UPDATE queue_entries SET priority = $1, updated_at = now() WHERE id = $2", [line[target].priority, entry.id]);
    const order = line.map((row) => row.id);
    [order[index], order[target]] = [order[target], order[index]];
    await writePositions(run, order);
  });
  return getQueueDetails(service.id);
};

module.exports = { getQueueDetails, serveNext, removeEntry, setPriority, moveEntry };
