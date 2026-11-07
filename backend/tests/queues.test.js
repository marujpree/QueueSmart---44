const request = require("supertest");
const app = require("../src/app");
const db = require("../src/db/db");
const { store, resetStore } = require("../src/data/store");
const {
  getQueue,
  getStatus,
  describeEntry,
  getMyEntry,
  joinQueue,
  leaveQueue,
  getQueueSummary,
} = require("../src/modules/queues/queueService");

const { query, resetTestDb } = db;

// test users live in both places until users move to db
const addUser = async (id) => {
  store.users.push({ id, name: `Test User ${id}`, email: `test${id}@example.com`, role: "user" });
  await query("INSERT INTO user_credentials (id, email, password_hash) VALUES ($1, $2, 'x')", [id, `test${id}@example.com`]);
  await query("INSERT INTO user_profiles (user_id, email, full_name) VALUES ($1, $2, $3)", [id, `test${id}@example.com`, `Test User ${id}`]);
  return id;
};

const catchError = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
};

const lineOf = async (queueId) =>
  (await query("SELECT position, user_id FROM queue_entries WHERE queue_id = $1 AND status = 'waiting' ORDER BY position", [queueId]))
    .rows.map((r) => [r.position, r.user_id]);

const emptyLine = (queueId) => query("UPDATE queue_entries SET status = 'served' WHERE queue_id = $1", [queueId]);

const fakeNextTransaction = (fake) => {
  const realTransaction = db.withTransaction;
  jest.spyOn(db, "withTransaction").mockImplementationOnce((callback) =>
    realTransaction((client) => callback({ query: (text, params) => fake(text, params) || client.query(text, params) }))
  );
};

beforeEach(async () => {
  resetStore();
  await resetTestDb();
  for (const id of [7, 8, 9]) await addUser(id);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getQueue ordering", () => {
  test("a high priority joiner goes ahead of earlier medium ones", async () => {
    await joinQueue(7, { serviceId: 3, priority: "medium" });
    await joinQueue(8, { serviceId: 3, priority: "medium" });
    await joinQueue(9, { serviceId: 3, priority: "high" });
    expect((await getQueue(3)).map((e) => e.userId)).toEqual([9, 7, 8]);
  });

  test("same priority stays in arrival order, low goes last", async () => {
    await joinQueue(7, { serviceId: 3, priority: "low" });
    await joinQueue(8, { serviceId: 3 });
    await joinQueue(9, { serviceId: 3 });
    expect((await getQueue(3)).map((e) => e.userId)).toEqual([8, 9, 7]);
  });

  test("a high joiner goes behind earlier high ones but ahead of medium", async () => {
    await joinQueue(7, { serviceId: 3, priority: "high" });
    await joinQueue(8, { serviceId: 3, priority: "medium" });
    await joinQueue(9, { serviceId: 3, priority: "high" });
    expect(await lineOf(3)).toEqual([[1, 7], [2, 9], [3, 8]]);
  });

  test("the line follows the position column, not who was inserted first", async () => {
    await query("INSERT INTO queue_entries (queue_id, user_id, position, join_time) VALUES (3, 7, 2, '2026-10-23T14:00:00Z')");
    await query("INSERT INTO queue_entries (queue_id, user_id, position, join_time) VALUES (3, 8, 1, '2026-10-23T15:00:00Z')");
    expect((await getQueue(3)).map((e) => e.userId)).toEqual([8, 7]);
  });

  test("entries come back in the camelCase api shape", async () => {
    const [entry] = await getQueue(4);
    expect(entry).toEqual({
      id: 403,
      userId: 2,
      name: "Aqeel Somani",
      email: "aqeel.somani@example.com",
      serviceId: 4,
      priority: "medium",
      status: "waiting",
      joinedAt: expect.any(String),
      position: 1,
    });
    expect(new Date(entry.joinedAt).toISOString()).toBe(entry.joinedAt);
  });

  test("served entries aren't in the line", async () => {
    expect((await getQueue(2)).map((e) => e.id)).toEqual([204, 205]);
  });

  test("an unknown service has an empty line", async () => {
    expect(await getQueue(999)).toEqual([]);
    expect(await getQueue("abc")).toEqual([]);
  });
});

describe("getStatus", () => {
  test("1 and 2 are almost ready, after that waiting", () => {
    expect(getStatus(1)).toBe("almost ready");
    expect(getStatus(2)).toBe("almost ready");
    expect(getStatus(3)).toBe("waiting");
    expect(getStatus(10)).toBe("waiting");
  });
});

describe("describeEntry", () => {
  test("adds service name, wait and status to an entry from getQueue", async () => {
    const [, second] = await getQueue(2);
    expect(await describeEntry(second)).toEqual({ entry: second, serviceName: "Financial Aid", position: 2, waitMinutes: 10, status: "almost ready" });
  });
});

describe("joinQueue validation", () => {
  test("missing serviceId", async () => {
    const err = await catchError(joinQueue(7, {}));
    expect(err.status).toBe(400);
    expect(err.fields.serviceId).toBe("Pick a service.");
    expect((await catchError(joinQueue(7))).status).toBe(400);
  });

  test("non-numeric or non-positive serviceId", async () => {
    for (const serviceId of ["abc", "5abc", "0x2", "1e1", " 2", "2.0", "-1", 1.5, 0, -2, true, [2]]) {
      const err = await catchError(joinQueue(7, { serviceId }));
      expect(err.status).toBe(400);
      expect(err.fields.serviceId).toBe("Service id must be a positive integer.");
    }
  });

  test("a numeric string serviceId is fine", async () => {
    expect((await joinQueue(7, { serviceId: "3" })).entry.serviceId).toBe(3);
  });

  test("unknown serviceId is 404", async () => {
    const err = await catchError(joinQueue(7, { serviceId: 999 }));
    expect(err.status).toBe(404);
    expect(err.message).toBe("Service not found.");
  });

  test("a closed queue is 409", async () => {
    await query("UPDATE queues SET status = 'closed' WHERE service_id = 1");
    const err = await catchError(joinQueue(7, { serviceId: 1 }));
    expect(err.status).toBe(409);
    expect(err.message).toBe("This service is closed.");
    expect(await lineOf(1)).toEqual([[1, 3]]);
  });

  test("bad priority", async () => {
    const err = await catchError(joinQueue(7, { serviceId: 1, priority: "urgent" }));
    expect(err.status).toBe(400);
    expect(err.fields.priority).toBeDefined();
  });

  test("priority defaults to medium", async () => {
    expect((await joinQueue(7, { serviceId: 1 })).entry.priority).toBe("medium");
  });

  test("can't join while already in a queue", async () => {
    await joinQueue(7, { serviceId: 1 });
    const err = await catchError(joinQueue(7, { serviceId: 2 }));
    expect(err.status).toBe(409);
    expect(err.message).toBe("You're already in a queue.");

    expect((await catchError(joinQueue(3, { serviceId: 2 }))).status).toBe(409);
  });

  test("a user who isn't in the database yet is 404", async () => {
    store.users.push({ id: 50, name: "Memory Only", email: "memory@example.com", role: "user" });
    const err = await catchError(joinQueue(50, { serviceId: 3 }));
    expect(err.status).toBe(404);
    expect(err.message).toBe("User not found.");
  });
});

describe("joinQueue", () => {
  test("adds an entry with the user's name and returns position and wait", async () => {
    await emptyLine(2);
    await joinQueue(7, { serviceId: 2 });
    const result = await joinQueue(8, { serviceId: 2, priority: "low" });

    expect(result).toMatchObject({ serviceName: "Financial Aid", position: 2, waitMinutes: 10, status: "almost ready" });
    expect(result.entry).toMatchObject({ userId: 8, name: "Test User 8", serviceId: 2, priority: "low", status: "waiting" });
    expect(new Date(result.entry.joinedAt).toISOString()).toBe(result.entry.joinedAt);

    const { rows } = await query("SELECT queue_id, user_id, position, priority, status FROM queue_entries WHERE id = $1", [result.entry.id]);
    expect(rows[0]).toEqual({ queue_id: 2, user_id: 8, position: 2, priority: "low", status: "waiting" });
  });

  test("demo student starts out of every queue and can join", async () => {
    expect(await getMyEntry(6)).toBeNull();
    expect(await joinQueue(6, { serviceId: 3 })).toMatchObject({ serviceName: "ID Card Services", position: 1 });
  });

  test("a new joiner goes behind seeded people with the same priority", async () => {
    expect((await joinQueue(7, { serviceId: 2 })).position).toBe(3);
  });

  test("gives the entry a new id across all queues", async () => {
    expect((await joinQueue(7, { serviceId: 1 })).entry.id).toBe(406);
  });

  test("a service with no queue row is 404", async () => {
    await query("DELETE FROM queues WHERE service_id = 3");
    const err = await catchError(joinQueue(7, { serviceId: 3 }));
    expect(err.status).toBe(404);
    expect(err.message).toBe("Service not found.");
  });

  test("creates a queue_update notification with the right position", async () => {
    await emptyLine(2);
    await joinQueue(7, { serviceId: 2 });
    await joinQueue(8, { serviceId: 2 });

    const { rows } = await query("SELECT * FROM notifications WHERE user_id = 8");
    const note = rows[0];
    expect(note).toMatchObject({ audience: "user", type: "queue_update", status: "sent" });
    expect(note.message).toBe("You're #2 in line for Financial Aid, about 10 min wait.");
  });

  test("writes a Waiting history row", async () => {
    const { entry } = await joinQueue(7, { serviceId: 1 });
    const { rows } = await query("SELECT * FROM queue_history WHERE user_id = 7");
    expect(rows).toMatchObject([{ service_id: 1, service_name: "Academic Advising", outcome: "Waiting", entry_id: entry.id }]);
  });

  test("a unique violation from the database still answers 409", async () => {
    const sent = [];
    fakeNextTransaction((text) => {
      sent.push(text.trim().split(" ")[0]);
      return text.includes("e.user_id = $1 AND e.status = 'waiting'") ? { rows: [], rowCount: 0 } : null;
    });
    const err = await catchError(joinQueue(3, { serviceId: 2 }));
    expect(sent.at(-1)).toBe("INSERT");
    expect(err.status).toBe(409);
    expect(err.message).toBe("You're already in a queue.");
    // rolled back
    expect(await lineOf(2)).toEqual([[1, 4], [2, 5]]);
  });

  test("a foreign key violation becomes 404", async () => {
    fakeNextTransaction((text) => {
      if (text.startsWith("INSERT")) throw Object.assign(new Error("fk detail from postgres"), { code: "23503" });
      return null;
    });
    const err = await catchError(joinQueue(7, { serviceId: 3 }));
    expect(err.status).toBe(404);
    expect(err.message).toBe("That user or service doesn't exist.");
  });
});

describe("positions", () => {
  test("stay 1..n with no gaps after joins and leaves", async () => {
    await addUser(10);
    for (const id of [7, 8, 9, 10]) await joinQueue(id, { serviceId: 3 });
    expect(await lineOf(3)).toEqual([[1, 7], [2, 8], [3, 9], [4, 10]]);

    await leaveQueue(8);
    expect(await lineOf(3)).toEqual([[1, 7], [2, 9], [3, 10]]);

    await joinQueue(8, { serviceId: 3, priority: "high" });
    await leaveQueue(10);
    await leaveQueue(7);
    expect(await lineOf(3)).toEqual([[1, 8], [2, 9]]);
  });

  test("other queues are never shifted", async () => {
    await joinQueue(7, { serviceId: 2, priority: "high" });
    await leaveQueue(7);
    expect(await lineOf(1)).toEqual([[1, 3]]);
    expect(await lineOf(4)).toEqual([[1, 2]]);
  });
});

describe("getMyEntry", () => {
  test("null when not in a queue", async () => {
    expect(await getMyEntry(7)).toBeNull();
  });

  test("position, wait and status", async () => {
    await emptyLine(4);
    await joinQueue(7, { serviceId: 4 });
    await joinQueue(8, { serviceId: 4 });
    await joinQueue(9, { serviceId: 4 });

    expect(await getMyEntry(7)).toMatchObject({ serviceName: "Registrar", position: 1, waitMinutes: 0, status: "almost ready" });
    expect(await getMyEntry(8)).toMatchObject({ position: 2, waitMinutes: 20, status: "almost ready" });
    expect(await getMyEntry(9)).toMatchObject({ position: 3, waitMinutes: 40, status: "waiting" });
  });

  test("moves up when someone ahead leaves", async () => {
    await emptyLine(4);
    await joinQueue(7, { serviceId: 4 });
    await joinQueue(8, { serviceId: 4 });
    await leaveQueue(7);
    expect(await getMyEntry(8)).toMatchObject({ position: 1, waitMinutes: 0 });
  });
});

describe("leaveQueue", () => {
  test("a new joiner never gets the id of an entry that left", async () => {
    const first = (await joinQueue(7, { serviceId: 1 })).entry.id;
    await leaveQueue(7);
    const second = (await joinQueue(8, { serviceId: 1 })).entry.id;
    expect(second).not.toBe(first);
    expect(second).toBe(first + 1);
  });

  test("leaving twice in a row leaves nothing waiting", async () => {
    await joinQueue(7, { serviceId: 1 });
    await leaveQueue(7);
    expect((await query("SELECT * FROM queue_entries WHERE user_id = 7 AND status = 'waiting'")).rowCount).toBe(0);
    await expect(leaveQueue(7)).rejects.toThrow("You're not in a queue.");
  });

  test("marks the entry canceled, keeps the row and writes a Left queue history row", async () => {
    const { entry } = await joinQueue(7, { serviceId: 1 });

    expect(await leaveQueue(7)).toEqual({ left: true, serviceName: "Academic Advising" });
    const { rows } = await query("SELECT status, updated_at FROM queue_entries WHERE id = $1", [entry.id]);
    expect(rows[0].status).toBe("canceled");
    expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(entry.joinedAt).getTime());
    expect(await getMyEntry(7)).toBeNull();
    const history = await query("SELECT * FROM queue_history WHERE user_id = 7");
    expect(history.rows).toMatchObject([{ service_id: 1, service_name: "Academic Advising", outcome: "Left queue", entry_id: entry.id }]);
  });

  test("shifts the people behind up by one", async () => {
    await joinQueue(7, { serviceId: 2 });
    expect(await lineOf(2)).toEqual([[1, 4], [2, 5], [3, 7]]);
    await leaveQueue(4);
    expect(await lineOf(2)).toEqual([[1, 5], [2, 7]]);
  });

  test("404 when not in a queue", async () => {
    const err = await catchError(leaveQueue(7));
    expect(err.status).toBe(404);
    expect(err.message).toBe("You're not in a queue.");
  });

  test("404 if they were served before the leave got the lock", async () => {
    fakeNextTransaction((text) => (text.startsWith("UPDATE queue_entries SET status = 'canceled'") ? { rows: [], rowCount: 0 } : null));
    const err = await catchError(leaveQueue(3));
    expect(err.status).toBe(404);
    expect(await lineOf(1)).toEqual([[1, 3]]);
  });
});

describe("getQueueSummary", () => {
  test("waiting count and the wait for someone joining now", async () => {
    expect(await getQueueSummary(2)).toEqual({ serviceId: 2, waiting: 2, estimatedWaitMinutes: 20 });
    expect(await getQueueSummary("4")).toEqual({ serviceId: 4, waiting: 1, estimatedWaitMinutes: 20 });
  });

  test("an empty line has no wait", async () => {
    expect(await getQueueSummary(3)).toEqual({ serviceId: 3, waiting: 0, estimatedWaitMinutes: 0 });
  });

  test("404 for an unknown service", async () => {
    expect((await catchError(getQueueSummary(999))).status).toBe(404);
    expect((await catchError(getQueueSummary("abc"))).status).toBe(404);
  });
});

describe("queue routes", () => {
  const as = (id, req) => req.set("x-user-id", String(id));

  test("401 without a user", async () => {
    expect((await request(app).get("/api/queues/me")).status).toBe(401);
    expect((await request(app).post("/api/queues/join").send({ serviceId: 1 })).status).toBe(401);
    expect((await request(app).post("/api/queues/leave")).status).toBe(401);
  });

  test("join, double join, me and leave", async () => {
    const joined = await as(7, request(app).post("/api/queues/join")).send({ serviceId: 1, priority: "high" });
    expect(joined.status).toBe(201);
    expect(joined.body).toMatchObject({ serviceName: "Academic Advising", position: 1, status: "almost ready" });
    expect(joined.body.entry.userId).toBe(7);

    const again = await as(7, request(app).post("/api/queues/join")).send({ serviceId: 2 });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "You're already in a queue." });

    const me = await as(7, request(app).get("/api/queues/me"));
    expect(me.status).toBe(200);
    expect(me.body).toEqual(joined.body);

    const left = await as(7, request(app).post("/api/queues/leave"));
    expect(left.status).toBe(200);
    expect(left.body).toEqual({ left: true, serviceName: "Academic Advising" });

    const after = await as(7, request(app).get("/api/queues/me"));
    expect(after.body).toEqual({ entry: null });

    expect((await as(7, request(app).post("/api/queues/leave"))).status).toBe(404);
  });

  test("a join is still there on later requests", async () => {
    await as(7, request(app).post("/api/queues/join")).send({ serviceId: 4 }).expect(201);

    const me = await as(7, request(app).get("/api/queues/me"));
    expect(me.body).toMatchObject({ serviceName: "Registrar", position: 2, entry: { userId: 7, status: "waiting" } });
    expect((await request(app).get("/api/queues/4/summary")).body.waiting).toBe(2);
    expect((await query("SELECT COUNT(*)::int AS n FROM queue_entries WHERE user_id = 7 AND status = 'waiting'")).rows[0].n).toBe(1);
  });

  test("join with a bad body returns 400 with fields", async () => {
    const res = await as(7, request(app).post("/api/queues/join")).send({ serviceId: "abc", priority: "urgent" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["priority", "serviceId"]);
  });

  test("join with no body returns 400", async () => {
    expect((await as(7, request(app).post("/api/queues/join"))).status).toBe(400);
  });

  test("an unexpected database error is a plain 500 with no database text", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(db, "withTransaction").mockRejectedValueOnce(Object.assign(new Error("relation queue_entries is broken"), { code: "XX000" }));
    const res = await as(7, request(app).post("/api/queues/join")).send({ serviceId: 1 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong." });
  });

  test("summary needs no login, 404 for an unknown service", async () => {
    const res = await request(app).get("/api/queues/4/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ serviceId: 4, waiting: 1, estimatedWaitMinutes: 20 });
    expect((await request(app).get("/api/queues/999/summary")).status).toBe(404);
  });
});