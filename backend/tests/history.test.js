const request = require("supertest");
const app = require("../src/app");
const { resetStore } = require("../src/data/store");
const { query, resetTestDb } = require("../src/db/db");
const { getHistory, addHistory } = require("../src/modules/history/historyService");
const { joinQueue, leaveQueue, serveNext } = require("../src/modules/queues/queueService");
const { addUser, count } = require("./helpers");

beforeEach(async () => {
  resetStore();
  await resetTestDb();
  for (const id of [7, 8, 9]) await addUser(id);
});

const notificationsAfter = async (lastId) =>
  (await query("SELECT user_id, title FROM notifications WHERE id > $1 ORDER BY id", [lastId])).rows.map((n) => [n.user_id, n.title]);
const lastNotificationId = async () => (await query("SELECT MAX(id)::int AS id FROM notifications")).rows[0].id;

describe("getHistory", () => {
  test("returns only that user's rows", async () => {
    expect(await getHistory(6)).toHaveLength(3);
    expect((await getHistory(6)).every((row) => row.userId === 6)).toBe(true);
  });

  test("returns camelCase rows with an ISO date", async () => {
    const [row] = await getHistory(6);
    expect(Object.keys(row).sort()).toEqual(["date", "entryId", "id", "outcome", "serviceId", "serviceName", "userId"]);
    expect(new Date(row.date).toISOString()).toBe(row.date);
  });

  test("newest first", async () => {
    const dates = (await getHistory(6)).map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("empty array for someone with no history", async () => {
    expect(await getHistory(7)).toEqual([]);
  });

  test("picks up a row written by addHistory", async () => {
    await addHistory({ userId: 7, serviceId: 1, serviceName: "Academic Advising", outcome: "Served" });
    expect(await getHistory(7)).toMatchObject([{ serviceName: "Academic Advising", outcome: "Served" }]);
  });

  test("a brand new row sorts ahead of the old ones", async () => {
    await addHistory({ userId: 6, serviceId: 1, serviceName: "Academic Advising", outcome: "Served" });
    expect(await getHistory(6)).toHaveLength(4);
    expect((await getHistory(6))[0].serviceName).toBe("Academic Advising");
  });

  test("a second outcome for the same entry updates the row instead of adding one", async () => {
    await addHistory({ userId: 7, serviceId: 1, serviceName: "Academic Advising", outcome: "Waiting", entryId: 500 });
    await addHistory({ userId: 7, serviceId: 1, serviceName: "Academic Advising", outcome: "Served", entryId: 500 });
    expect(await getHistory(7)).toMatchObject([{ outcome: "Served", entryId: 500 }]);
    expect(await count("queue_history", "user_id = 7")).toBe(1);
  });

  test("rows without an entry id are always inserted", async () => {
    await addHistory({ userId: 7, serviceName: "Walk-up", outcome: "Served" });
    await addHistory({ userId: 7, serviceName: "Walk-up", outcome: "Served" });
    expect(await getHistory(7)).toHaveLength(2);
    expect((await getHistory(7))[0]).toMatchObject({ serviceId: null, entryId: null });
  });
});

describe("leaving and being served both write history", () => {
  test("joining writes a Waiting row", async () => {
    await joinQueue(7, { serviceId: 3 });
    expect(await getHistory(7)).toMatchObject([{ serviceName: "ID Card Services", outcome: "Waiting" }]);
  });

  test("leaving a queue writes a Left queue row", async () => {
    await joinQueue(7, { serviceId: 3 });
    await leaveQueue(7);
    expect(await getHistory(7)).toMatchObject([{ serviceName: "ID Card Services", outcome: "Left queue" }]);
  });

  test("being served writes a Served row", async () => {
    await joinQueue(7, { serviceId: 3 });
    await serveNext(3);
    expect(await getHistory(7)).toMatchObject([{ serviceName: "ID Card Services", outcome: "Served" }]);
  });
});

describe("serveNext notifications", () => {
  test("tells the person served and the next two in line", async () => {
    for (const id of [7, 8, 9]) await joinQueue(id, { serviceId: 3 });
    const last = await lastNotificationId();
    await serveNext(3);
    expect(await notificationsAfter(last)).toEqual([
      [7, "You've been served"],
      [8, "Almost your turn"],
      [9, "Almost your turn"],
    ]);
  });

  test("only notifies people who are actually waiting", async () => {
    await joinQueue(7, { serviceId: 3 });
    await joinQueue(8, { serviceId: 3 });
    const last = await lastNotificationId();
    await serveNext(3);
    expect(await notificationsAfter(last)).toHaveLength(2);
  });

  test("serving the last person notifies nobody else", async () => {
    await joinQueue(7, { serviceId: 3 });
    const last = await lastNotificationId();
    await serveNext(3);
    expect(await notificationsAfter(last)).toHaveLength(1);
  });
});

describe("GET /api/history", () => {
  test("401 without a user header", async () => {
    await request(app).get("/api/history").expect(401);
  });

  test("returns the signed in user's own rows", async () => {
    const res = await request(app).get("/api/history").set("x-user-id", "6");
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(3);
    expect(res.body.history.every((row) => row.userId === 6)).toBe(true);
  });

  test("you cannot see someone else's history", async () => {
    const res = await request(app).get("/api/history").set("x-user-id", "7");
    expect(res.body.history).toEqual([]);
  });

  test("a served visit shows up over the API", async () => {
    await joinQueue(7, { serviceId: 3 });
    await request(app).post("/api/queues/3/serve-next").set("x-user-id", "1").expect(200);
    const res = await request(app).get("/api/history").set("x-user-id", "7");
    expect(res.body.history[0]).toMatchObject({ serviceName: "ID Card Services", outcome: "Served" });
  });
});
