const { store } = require("../../data/store");
const { badRequest, notFound, conflict } = require("../../utils/httpError");
const { getService } = require("../services/service");
const { addHistory } = require("../history/historyService");
const { notifyServed, notifyAlmostReady, notifyRemoved } = require("../notifications/notificationService");
const { priorities, getQueue, describeEntry, getQueueSummary } = require("./queueService");

const getQueueDetails = (serviceId) => {
  const service = getService(serviceId);
  return {
    ...getQueueSummary(service.id),
    entries: getQueue(service.id).map(describeEntry),
  };
};

//add next served person controlled by admin advancing the queue
const serveNext = async (serviceId) => {
  const service = getService(serviceId);
  const entry = getQueue(service.id)[0];
  if (!entry) throw conflict("No one waiting for this service.");
  entry.status = "served";
  entry.servedAt = new Date().toISOString();
  await addHistory({ userId: entry.userId, serviceId: service.id, serviceName: service.name, outcome: "Served", entryId: entry.id });
  await notifyServed(entry.userId, service.name);

  const almostReady = getQueue(service.id)
    .slice(0, 2)
    .filter((next) => !next.almostReadyNotified);
  for (const next of almostReady) {
    next.almostReadyNotified = true;
    await notifyAlmostReady(next.userId, service.name);
  }
  return { servedEntry: entry, ...getQueueDetails(service.id) };
};

const findEntry = (serviceId, entryId) => {
  const service = getService(serviceId);
  const entry = (store.queues[service.id] || []).find(
  (e) => e.id === Number(entryId) && e.status === "waiting"
  );
  if (!entry) throw notFound ("That person isn't waiting in this queue.");
  return { service, entry };
}

const removeEntry = async (serviceId, entryId) => {
  const { service, entry } = findEntry(serviceId, entryId);
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
  return getQueueDetails(service.id)
};

const setPriority = (serviceId, entryId, priority) => {
  if (!priorities.includes(priority)) {
    throw badRequest("Priority must be \"low\", \"medium\" or \"high\".", {
      priority: "Priority must be \"low\", \"medium\" or \"high\".",
  });
}
const { service, entry } = findEntry(serviceId, entryId);
entry.priority = priority;
return getQueueDetails(service.id)
};

const moveEntry = (serviceId, entryId, direction) => {
  if (direction !== "up" && direction !== "down") {
    throw badRequest("Direction must be \"up\" or \"down\".", { direction: "Direction must be \"up\" or \"down\"." });
  }
    const { service } = findEntry(serviceId, entryId);
    const line = getQueue(service.id);
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

    return getQueueDetails(service.id);
};

module.exports = { getQueueDetails, serveNext, removeEntry, setPriority, moveEntry };