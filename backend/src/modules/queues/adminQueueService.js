const { store } = require("../../data/store");
const { badRequest, notFound, conflict } = require("../../utils/httpError");
const { getService } = require("../services/service");
const { addHistory } = require("../history/historyService");
const { notifyServed, notifyAlmostReady, notifyRemoved } = require("../notifications/notificationService");
const { priorities, getQueue, describeEntry, getQueueSummary } = require("./queueService");

const getQueueDetails = async (serviceId) => {
  const service = await getService(serviceId);
  const entries = await getQueue(service.id);
  return {
    ...(await getQueueSummary(service.id)),
    entries: await Promise.all(entries.map(describeEntry)),
  };
};

//add next served person controlled by admin advancing the queue
const serveNext = async (serviceId) => {
  const service = await getService(serviceId);
  const entry = (await getQueue(service.id))[0];
  if (!entry) throw conflict("No one waiting for this service.");
  entry.status = "served";
  entry.servedAt = new Date().toISOString();
  await addHistory({ userId: entry.userId, serviceId: service.id, serviceName: service.name, outcome: "Served", entryId: entry.id });
  await notifyServed(entry.userId, service.name);

  const almostReady = (await getQueue(service.id))
    .slice(0, 2)
    .filter((next) => !next.almostReadyNotified);
  for (const next of almostReady) {
    next.almostReadyNotified = true;
    await notifyAlmostReady(next.userId, service.name);
  }
  return { servedEntry: entry, ...(await getQueueDetails(service.id)) };
};

const findEntry = async (serviceId, entryId) => {
  const service = await getService(serviceId);
  const entry = (store.queues[service.id] || []).find(
  (e) => e.id === Number(entryId) && e.status === "waiting"
  );
  if (!entry) throw notFound ("That person isn't waiting in this queue.");
  return { service, entry };
}

const removeEntry = async (serviceId, entryId) => {
  const { service, entry } = await findEntry(serviceId, entryId);
  const queue = store.queues[service.id];
  queue.splice(queue.indexOf(entry), 1);
  await addHistory({
    userId: entry.userId,
    serviceId: service.id,
    serviceName: service.name,
    outcome: "Removed by admin",
    entryId: entry.id,
  });
  await notifyRemoved(entry.userId, service.name);
  return await getQueueDetails(service.id);
};

const setPriority = async (serviceId, entryId, priority) => {
  if (!priorities.includes(priority)) {
    throw badRequest("Priority must be \"low\", \"medium\" or \"high\".", {
      priority: "Priority must be \"low\", \"medium\" or \"high\".",
  });
}
const { service, entry } = await findEntry(serviceId, entryId);
entry.priority = priority;
return await getQueueDetails(service.id);
};

const moveEntry = async (serviceId, entryId, direction) => {
  if (direction !== "up" && direction !== "down") {
    throw badRequest("Direction must be \"up\" or \"down\".", { direction: "Direction must be \"up\" or \"down\"." });
  }
    const { service } = await findEntry(serviceId, entryId);
    const line = await getQueue(service.id);
    const index = line.findIndex((e) => e.id === Number(entryId));
    const target = index + (direction === "up" ? -1 : 1);
    if (target < 0) throw conflict("That person is already at the front of the line.");
    if (target >= line.length) throw conflict("That person is already at the end of the line.");

    line.forEach((e, i ) => { e.orderAt = i; });

    const entry = line[index];
    const neighbour = line[target];

    entry.priority = neighbour.priority;

    const slot = entry.orderAt;
    entry.orderAt = neighbour.orderAt;
    neighbour.orderAt = slot;

    return await getQueueDetails(service.id);
};

module.exports = { getQueueDetails, serveNext, removeEntry, setPriority, moveEntry };
