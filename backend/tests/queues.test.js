const { persistTestUsers } = require("./userFixtures");
const request = require("supertest");
const app = require("../src/app");
const { store, resetStore } = require("../src/data/store");
const {
  getQueue,
  getStatus,
  getMyEntry,
  joinQueue,
  leaveQueue,
  getQueueSummary,
} = require("../src/modules/queues/queueService");

const addUser = (id) => {
  store.users.push({ id, name: `Test User ${id}`, email: `test${id}@example.com`, role: "user" });
  return id;
};

const catchError = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
};

beforeEach(async () => {
  resetStore();
  [7, 8, 9].forEach(addUser);
  await persistTestUsers();
});

describe("getQueue ordering", () => {
  beforeEach(() => {
    store.queues[3] = [];
  });

  test("a high priority joiner goes ahead of earlier medium ones", () => {
    joinQueue(7, { serviceId: 3, priority: "medium" });
    joinQueue(8, { serviceId: 3, priority: "medium" });
    joinQueue(9, { serviceId: 3, priority: "high" });
    expect(getQueue(3).map((e) => e.userId)).toEqual([9, 7, 8]);
  });

  test("same priority stays in arrival order, low goes last", () => {
    joinQueue(7, { serviceId: 3, priority: "low" });
    joinQueue(8, { serviceId: 3 });
    joinQueue(9, { serviceId: 3 });
    expect(getQueue(3).map((e) => e.userId)).toEqual([8, 9, 7]);
  });

  test("earlier joinedAt goes first within a priority", () => {
    store.queues[3] = [
      { id: 1, userId: 7, serviceId: 3, priority: "medium", status: "waiting", joinedAt: "2026-10-23T15:00:00.000Z" },
      { id: 2, userId: 8, serviceId: 3, priority: "medium", status: "waiting", joinedAt: "2026-10-23T14:00:00.000Z" },
    ];
    expect(getQueue(3).map((e) => e.userId)).toEqual([8, 7]);
  });

  test("served entries aren't in the line", () => {
    expect(getQueue(2).map((e) => e.id)).toEqual([204, 205]);
  });

  test("an unknown service has an empty line", () => {
    expect(getQueue(999)).toEqual([]);
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

describe("joinQueue validation", () => {
  test("missing serviceId", () => {
    const err = catchError(() => joinQueue(7, {}));
    expect(err.status).toBe(400);
    expect(err.fields.serviceId).toBe("Pick a service.");
    expect(catchError(() => joinQueue(7)).status).toBe(400);
  });

  test("non-numeric or non-positive serviceId", () => {
    for (const serviceId of ["abc", "5abc", "0x2", "1e1", " 2", "2.0", "-1", 1.5, 0, -2, true, [2]]) {
      const err = catchError(() => joinQueue(7, { serviceId }));
      expect(err.status).toBe(400);
      expect(err.fields.serviceId).toBe("Service id must be a positive integer.");
    }
  });

  test("a numeric string serviceId is fine", () => {
    store.queues[3] = [];
    expect(joinQueue(7, { serviceId: "3" }).entry.serviceId).toBe(3);
  });

  test("unknown serviceId is 404", () => {
    const err = catchError(() => joinQueue(7, { serviceId: 999 }));
    expect(err.status).toBe(404);
    expect(err.message).toBe("Service not found.");
  });

  test("closed service is 409", () => {
    store.services.find((s) => s.id === 1).isOpen = false;
    const err = catchError(() => joinQueue(7, { serviceId: 1 }));
    expect(err.status).toBe(409);
    expect(err.message).toBe("This service is closed.");
  });

  test("bad priority", () => {
    const err = catchError(() => joinQueue(7, { serviceId: 1, priority: "urgent" }));
    expect(err.status).toBe(400);
    expect(err.fields.priority).toBeDefined();
  });

  test("priority defaults to medium", () => {
    expect(joinQueue(7, { serviceId: 1 }).entry.priority).toBe("medium");
  });

  test("can't join while already in a queue", () => {
    joinQueue(7, { serviceId: 1 });
    const err = catchError(() => joinQueue(7, { serviceId: 2 }));
    expect(err.status).toBe(409);
    expect(err.message).toBe("You're already in a queue.");

    expect(catchError(() => joinQueue(3, { serviceId: 2 })).status).toBe(409);
  });
});

describe("joinQueue", () => {
  test("adds an entry with the user's name and returns position and wait", () => {
    store.queues[2] = [];
    joinQueue(7, { serviceId: 2 });
    const result = joinQueue(8, { serviceId: 2, priority: "low" });

    expect(result).toMatchObject({ serviceName: "Financial Aid", position: 2, waitMinutes: 10, status: "almost ready" });
    expect(result.entry).toMatchObject({ userId: 8, name: "Test User 8", serviceId: 2, priority: "low", status: "waiting" });
    expect(new Date(result.entry.joinedAt).toISOString()).toBe(result.entry.joinedAt);
    expect(store.queues[2]).toContain(result.entry);
  });

  test("demo student starts out of every queue and can join", () => {
    expect(getMyEntry(6)).toBeNull();
    expect(joinQueue(6, { serviceId: 3 })).toMatchObject({ serviceName: "ID Card Services", position: 1 });
  });

  test("a new joiner goes behind seeded people with the same priority", () => {
    expect(joinQueue(7, { serviceId: 2 }).position).toBe(3);
  });

  test("gives the entry a new id across all queues", () => {
    expect(joinQueue(7, { serviceId: 1 }).entry.id).toBe(406);
  });

  test("creates the queue if the service didn't have one", () => {
    delete store.queues[3];
    expect(joinQueue(7, { serviceId: 3 }).position).toBe(1);
    expect(store.queues[3]).toHaveLength(1);
  });

  test("creates a queue_update notification with the right position", () => {
    store.queues[2] = [];
    joinQueue(7, { serviceId: 2 });
    joinQueue(8, { serviceId: 2 });

    const note = store.notifications.find((n) => n.userId === 8);
    expect(note).toMatchObject({ audience: "user", type: "queue_update", read: false });
    expect(note.message).toBe("You're #2 in line for Financial Aid, about 10 min wait.");
  });
});

describe("getMyEntry", () => {
  test("null when not in a queue", () => {
    expect(getMyEntry(7)).toBeNull();
  });

  test("position, wait and status", () => {
    store.queues[4] = [];
    joinQueue(7, { serviceId: 4 });
    joinQueue(8, { serviceId: 4 });
    joinQueue(9, { serviceId: 4 });

    expect(getMyEntry(7)).toMatchObject({ serviceName: "Registrar", position: 1, waitMinutes: 0, status: "almost ready" });
    expect(getMyEntry(8)).toMatchObject({ position: 2, waitMinutes: 20, status: "almost ready" });
    expect(getMyEntry(9)).toMatchObject({ position: 3, waitMinutes: 40, status: "waiting" });
  });

  test("moves up when someone ahead leaves", () => {
    store.queues[4] = [];
    joinQueue(7, { serviceId: 4 });
    joinQueue(8, { serviceId: 4 });
    leaveQueue(7);
    expect(getMyEntry(8)).toMatchObject({ position: 1, waitMinutes: 0 });
  });
});

describe("leaveQueue", () => {
  test("a new joiner never gets the id of an entry that left", () => {
    const first = joinQueue(7, { serviceId: 1 }).entry.id;
    leaveQueue(7);
    const second = joinQueue(8, { serviceId: 1 }).entry.id;
    expect(second).not.toBe(first);
    expect(second).toBe(first + 1);
  });

  test("leaving twice in a row leaves nothing behind", () => {
    joinQueue(7, { serviceId: 1 });
    leaveQueue(7);
    expect(Object.values(store.queues).flat().filter((e) => e.userId === 7)).toEqual([]);
    expect(() => leaveQueue(7)).toThrow("You're not in a queue.");
  });

  test("removes the entry and writes a Left queue history row", () => {
    const { entry } = joinQueue(7, { serviceId: 1 });

    expect(leaveQueue(7)).toEqual({ left: true, serviceName: "Academic Advising" });
    expect(store.queues[1]).not.toContain(entry);
    expect(getMyEntry(7)).toBeNull();
    expect(store.history.at(-1)).toMatchObject({ userId: 7, serviceId: 1, serviceName: "Academic Advising", outcome: "Left queue" });
  });

  test("404 when not in a queue", () => {
    const err = catchError(() => leaveQueue(7));
    expect(err.status).toBe(404);
    expect(err.message).toBe("You're not in a queue.");
  });
});

describe("getQueueSummary", () => {
  test("waiting count and the wait for someone joining now", () => {
    expect(getQueueSummary(2)).toEqual({ serviceId: 2, waiting: 2, estimatedWaitMinutes: 20 });
    expect(getQueueSummary("4")).toEqual({ serviceId: 4, waiting: 1, estimatedWaitMinutes: 20 });
  });

  test("an empty line has no wait", () => {
    store.queues[3] = [];
    expect(getQueueSummary(3)).toEqual({ serviceId: 3, waiting: 0, estimatedWaitMinutes: 0 });
  });

  test("404 for an unknown service", () => {
    expect(catchError(() => getQueueSummary(999)).status).toBe(404);
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

  test("join with a bad body returns 400 with fields", async () => {
    const res = await as(7, request(app).post("/api/queues/join")).send({ serviceId: "abc", priority: "urgent" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["priority", "serviceId"]);
  });

  test("join with no body returns 400", async () => {
    expect((await as(7, request(app).post("/api/queues/join"))).status).toBe(400);
  });

  test("summary needs no login, 404 for an unknown service", async () => {
    const res = await request(app).get("/api/queues/4/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ serviceId: 4, waiting: 1, estimatedWaitMinutes: 20 });
    expect((await request(app).get("/api/queues/999/summary")).status).toBe(404);
  });
});