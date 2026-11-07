const request = require("supertest");
const app = require("../src/app");
const { store, resetStore } = require("../src/data/store");
const { addUser } = require("./helpers");
const { estimateWait } = require("../src/modules/waitTime/waitTimeService");
const { joinQueue, leaveQueue, getMyEntry, getQueueSummary, serveNext } = require("../src/modules/queues/queueService");
const { updateService } = require("../src/modules/services/service");
const { query, resetTestDb } = require("../src/db/db");

beforeEach(async () => {
  resetStore();
  await resetTestDb();
  store.queues[3] = [];
  for (const id of [7, 8, 9]) await addUser(id);
});

test("15 minutes per person gives 0, 15, 30 and 45 minute waits", () => {
  expect([1, 2, 3, 4].map(position => estimateWait(position, 15))).toEqual([0, 15, 30, 45]);
});

test("invalid inputs cannot produce negative or invalid estimates", () => {
  for (const position of [0, -1, 1.5, NaN, Infinity, "2"]) {
    expect(() => estimateWait(position, 15)).toThrow(RangeError);
  }
  for (const duration of [0, -1, 1.5, 481, NaN, Infinity, "15"]) {
    expect(() => estimateWait(2, duration)).toThrow(RangeError);
  }
});

test("joining, leaving and finishing a visit recalculate the real queue", async () => {
  await joinQueue(7, { serviceId: 3 });
  await joinQueue(8, { serviceId: 3 });
  expect((await joinQueue(9, { serviceId: 3 })).waitMinutes).toBe(10);
  await leaveQueue(7);
  expect(await getMyEntry(9)).toMatchObject({ position: 2, waitMinutes: 5 });
  const result = await serveNext(3);
  expect(result.servedEntry).toMatchObject({ userId: 8, status: "served" });
  expect(await getMyEntry(8)).toBeNull();
  expect(await getMyEntry(9)).toMatchObject({ position: 1, waitMinutes: 0 });
  expect((await query("SELECT 1 FROM queue_history WHERE user_id = 8 AND outcome = 'Served'")).rowCount).toBe(1);
  expect((await query("SELECT 1 FROM notifications WHERE user_id = 8 AND title = 'You''ve been served'")).rowCount).toBe(1);
});

test("editing the duration applies to existing entries on the next read", async () => {
  await joinQueue(7, { serviceId: 3 });
  await joinQueue(8, { serviceId: 3 });
  await updateService(3, { durationMinutes: 12 });
  expect((await getMyEntry(8)).waitMinutes).toBe(12);
  expect((await getQueueSummary(3)).estimatedWaitMinutes).toBe(24);
});

test("priority changes who is ahead, so it also changes the estimate", async () => {
  await joinQueue(7, { serviceId: 3 });
  await joinQueue(8, { serviceId: 3, priority: "high" });
  expect(await getMyEntry(7)).toMatchObject({ position: 2, waitMinutes: 5 });
  expect((await serveNext(3)).servedEntry.userId).toBe(8);
});

test("admin routes reject anonymous and ordinary users", async () => {
  for (const userId of [null, 7]) {
    const get = request(app).get("/api/queues/3/entries");
    const post = request(app).post("/api/queues/3/serve-next");
    if (userId) { get.set("x-user-id", String(userId)); post.set("x-user-id", String(userId)); }
    expect((await get).status).toBe(userId ? 403 : 401);
    expect((await post).status).toBe(userId ? 403 : 401);
  }
});

test("admin can read server estimates and advance the queue through the API", async () => {
  await joinQueue(7, { serviceId: 3 });
  await joinQueue(8, { serviceId: 3 });
  const list = await request(app).get("/api/queues/3/entries").set("x-user-id", "1");
  expect(list.status).toBe(200);
  expect(list.body.entries.map(e => e.waitMinutes)).toEqual([0, 5]);
  const served = await request(app).post("/api/queues/3/serve-next").set("x-user-id", "1");
  expect(served.status).toBe(200);
  expect(served.body.entries[0]).toMatchObject({ position: 1, waitMinutes: 0 });
  await request(app).post("/api/queues/3/serve-next").set("x-user-id", "1").expect(200);
  await request(app).post("/api/queues/3/serve-next").set("x-user-id", "1").expect(409);
  await request(app).post("/api/queues/999/serve-next").set("x-user-id", "1").expect(404);
});