const { persistTestUsers } = require("./userFixtures");
const request = require("supertest");
const app = require("../src/app");
const { store, resetStore } = require("../src/data/store");
const { getHistory, addHistory } = require("../src/modules/history/historyService");
const { joinQueue, leaveQueue, serveNext } = require("../src/modules/queues/queueService");

const addUser = (id) => {
  store.users.push({ id, name: `Test User ${id}`, email: `test${id}@example.com`, role: "user" });
  return id;
};

beforeEach(async () => {
  resetStore();
  [7, 8, 9].forEach(addUser);
  await persistTestUsers();
});

describe("getHistory", () => {
  test("returns only that user's rows", () => {
    expect(getHistory(6)).toHaveLength(3);
    expect(getHistory(6).every((row) => row.userId === 6)).toBe(true);
  });

  test("newest first", () => {
    const dates = getHistory(6).map((row) => row.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("empty array for someone with no history", () => {
    expect(getHistory(7)).toEqual([]);
  });

  test("does not reorder the stored history", () => {
    const before = store.history.map((row) => row.id);
    getHistory(6);
    expect(store.history.map((row) => row.id)).toEqual(before);
  });

  test("picks up a row written by addHistory", () => {
    addHistory({ userId: 7, serviceId: 1, serviceName: "Academic Advising", outcome: "Served" });
    expect(getHistory(7)).toMatchObject([{ serviceName: "Academic Advising", outcome: "Served" }]);
  });

  test("a brand new row sorts ahead of the old ones", () => {
    addHistory({ userId: 6, serviceId: 1, serviceName: "Academic Advising", outcome: "Served" });
    expect(getHistory(6)).toHaveLength(4);
    expect(getHistory(6)[0].serviceName).toBe("Academic Advising");
  });
});

describe("leaving and being served both write history", () => {
  test("leaving a queue writes a Left queue row", () => {
    joinQueue(7, { serviceId: 3 });
    leaveQueue(7);
    expect(getHistory(7)).toMatchObject([{ serviceName: "ID Card Services", outcome: "Left queue" }]);
  });

  test("being served writes a Served row", () => {
    joinQueue(7, { serviceId: 3 });
    serveNext(3);
    expect(getHistory(7)).toMatchObject([{ serviceName: "ID Card Services", outcome: "Served" }]);
  });
});

describe("serveNext notifications", () => {
  test("tells the person served and the next two in line", () => {
    [7, 8, 9].forEach((id) => joinQueue(id, { serviceId: 3 }));
    const before = store.notifications.length;
    serveNext(3);
    expect(store.notifications.slice(before).map((n) => [n.userId, n.title])).toEqual([
      [7, "You've been served"],
      [8, "Almost your turn"],
      [9, "Almost your turn"],
    ]);
  });

  test("only notifies people who are actually waiting", () => {
    joinQueue(7, { serviceId: 3 });
    joinQueue(8, { serviceId: 3 });
    const before = store.notifications.length;
    serveNext(3);
    expect(store.notifications.slice(before)).toHaveLength(2);
  });

  test("serving the last person notifies nobody else", () => {
    joinQueue(7, { serviceId: 3 });
    const before = store.notifications.length;
    serveNext(3);
    expect(store.notifications.slice(before)).toHaveLength(1);
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
    joinQueue(7, { serviceId: 3 });
    await request(app).post("/api/queues/3/serve-next").set("x-user-id", "1").expect(200);
    const res = await request(app).get("/api/history").set("x-user-id", "7");
    expect(res.body.history[0]).toMatchObject({ serviceName: "ID Card Services", outcome: "Served" });
  });
});
