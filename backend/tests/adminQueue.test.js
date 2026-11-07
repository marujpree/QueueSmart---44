const request = require("supertest");
const app = require("../src/app");
const { query, resetTestDb } = require("../src/db/db");
const {
  getQueue,
  joinQueue,
  getQueueDetails,
  serveNext,
  removeEntry,
  setPriority,
  moveEntry,
} = require("../src/modules/queues/queueService");
const { addUser, catchError } = require("./helpers");

const lineOf = async (serviceId) => (await getQueue(serviceId)).map((e) => e.userId);

// what the database holds for one entry
const rowOf = async (entryId) => (await query("SELECT status, position, priority FROM queue_entries WHERE id = $1", [entryId])).rows[0];

let ids;

beforeEach(async () => {
  await resetTestDb();
  for (const id of [7, 8, 9, 10]) await addUser(id);
  ids = [];
  for (const userId of [7, 8, 9]) ids.push((await joinQueue(userId, { serviceId: 3 })).entry.id);
});

describe("getQueueDetails", () => {
  test("summary plus every waiting entry in line order with position and status", async () => {
    const details = await getQueueDetails(3);
    expect(details).toMatchObject({ serviceId: 3, waiting: 3, estimatedWaitMinutes: 15 });
    expect(details.entries.map((e) => [e.entry.userId, e.position, e.status])).toEqual([
      [7, 1, "almost ready"],
      [8, 2, "almost ready"],
      [9, 3, "waiting"],
    ]);
  });

  test("404 for an unknown service", async () => {
    expect((await catchError(() => getQueueDetails(999))).status).toBe(404);
  });
});

describe("serveNext", () => {
  test("serves the front of the line and stamps servedAt", async () => {
    const { servedEntry, entries } = await serveNext(3);
    expect(servedEntry).toMatchObject({ userId: 7, status: "served" });
    expect(new Date(servedEntry.servedAt).toISOString()).toBe(servedEntry.servedAt);
    expect(entries.map((e) => e.entry.userId)).toEqual([8, 9]);
  });

  test("saves the served status in queue_entries and moves everyone up", async () => {
    await serveNext(3);
    expect((await rowOf(ids[0])).status).toBe("served");
    expect(await rowOf(ids[1])).toMatchObject({ status: "waiting", position: 1 });
    expect(await rowOf(ids[2])).toMatchObject({ status: "waiting", position: 2 });
  });

  test("the served person is free to join a queue again", async () => {
    await serveNext(3);
    expect((await joinQueue(7, { serviceId: 1 })).serviceName).toBe("Academic Advising");
  });

  test("writes a Served history row and a served notification", async () => {
    await serveNext(3);
    const history = await query("SELECT user_id, outcome FROM queue_history WHERE entry_id = $1", [ids[0]]);
    expect(history.rows).toEqual([{ user_id: 7, outcome: "Served" }]);
    const note = await query("SELECT 1 FROM notifications WHERE user_id = 7 AND title = 'You''ve been served'");
    expect(note.rowCount).toBe(1);
  });

  test("409 when nobody is waiting", async () => {
    await query("UPDATE queue_entries SET status = 'served' WHERE queue_id = 3");
    const err = await catchError(() => serveNext(3));
    expect(err.status).toBe(409);
    expect(err.message).toBe("No one waiting for this service.");
  });

  test("404 for an unknown service", async () => {
    expect((await catchError(() => serveNext(999))).status).toBe(404);
  });

  test("tells each person almost ready only once", async () => {
    await joinQueue(10, { serviceId: 3 });
    const { rows: last } = await query("SELECT MAX(id)::int AS id FROM notifications");
    await serveNext(3);
    await serveNext(3);

    const { rows } = await query("SELECT user_id FROM notifications WHERE id > $1 AND title = 'Almost your turn' ORDER BY id", [last[0].id]);
    expect(rows.map((n) => n.user_id)).toEqual([8, 9, 10]);
  });

  test("serving the last person tells nobody else", async () => {
    await removeEntry(3, ids[1]);
    await removeEntry(3, ids[2]);
    const { rows: last } = await query("SELECT MAX(id)::int AS id FROM notifications");
    await serveNext(3);
    const { rows } = await query("SELECT title FROM notifications WHERE id > $1", [last[0].id]);
    expect(rows.map((n) => n.title)).toEqual(["You've been served"]);
  });
});

describe("removeEntry", () => {
  test("takes them out of the line, writes history and notifies them", async () => {
    const details = await removeEntry(3, ids[1]);

    expect(details.entries.map((e) => e.entry.userId)).toEqual([7, 9]);
    const history = await query("SELECT user_id, outcome FROM queue_history WHERE entry_id = $1", [ids[1]]);
    expect(history.rows).toEqual([{ user_id: 8, outcome: "Removed by admin" }]);
    const { rows } = await query("SELECT * FROM notifications ORDER BY id DESC LIMIT 1");
    expect(rows[0]).toMatchObject({
      audience: "user",
      user_id: 8,
      type: "status_change",
      title: "Removed from the queue",
      message: "An admin removed you from the ID Card Services queue.",
    });
  });

  test("keeps the row as canceled and closes the gap", async () => {
    await removeEntry(3, ids[0]);
    expect((await rowOf(ids[0])).status).toBe("canceled");
    expect(await rowOf(ids[1])).toMatchObject({ position: 1 });
    expect(await rowOf(ids[2])).toMatchObject({ position: 2 });
  });

  test("the removed person can join again", async () => {
    await removeEntry(3, ids[0]);
    expect((await joinQueue(7, { serviceId: 1 })).serviceName).toBe("Academic Advising");
  });

  test("404 for an unknown entry, a bad id, one in another service, or one already served", async () => {
    expect((await catchError(() => removeEntry(3, 9999))).status).toBe(404);
    expect((await catchError(() => removeEntry(3, "abc"))).status).toBe(404);
    expect((await catchError(() => removeEntry(2, ids[0]))).status).toBe(404);
    await serveNext(3);
    expect((await catchError(() => removeEntry(3, ids[0]))).message).toBe("That person isn't waiting in this queue.");
  });

  test("404 for a service that doesn't exist", async () => {
    expect((await catchError(() => removeEntry(999, 403))).status).toBe(404);
  });
});

describe("setPriority", () => {
  test("raising someone to high moves them to the front", async () => {
    await setPriority(3, ids[2], "high");
    expect(await lineOf(3)).toEqual([9, 7, 8]);
  });

  test("lowering someone to low moves them to the back", async () => {
    await setPriority(3, ids[0], "low");
    expect(await lineOf(3)).toEqual([8, 9, 7]);
  });

  test("saves the new priority and positions in queue_entries", async () => {
    await setPriority(3, ids[2], "high");
    expect(await rowOf(ids[2])).toMatchObject({ priority: "high", position: 1 });
    expect(await rowOf(ids[0])).toMatchObject({ priority: "medium", position: 2 });
  });

  test("goes behind earlier joiners of the same priority", async () => {
    await setPriority(3, ids[0], "high");
    await setPriority(3, ids[2], "high");
    expect(await lineOf(3)).toEqual([7, 9, 8]);
  });

  test("400 with a field error for a bad or missing priority", async () => {
    for (const priority of ["urgent", undefined, "HIGH"]) {
      const err = await catchError(() => setPriority(3, ids[0], priority));
      expect(err.status).toBe(400);
      expect(err.fields.priority).toBeDefined();
    }
  });

  test("404 for someone not waiting here", async () => {
    expect((await catchError(() => setPriority(3, 9999, "high"))).status).toBe(404);
  });
});

describe("moveEntry", () => {
  test("up swaps with the person ahead", async () => {
    await moveEntry(3, ids[2], "up");
    expect(await lineOf(3)).toEqual([7, 9, 8]);
  });

  test("down swaps with the person behind", async () => {
    await moveEntry(3, ids[0], "down");
    expect(await lineOf(3)).toEqual([8, 7, 9]);
  });

  test("saves the new positions in queue_entries", async () => {
    await moveEntry(3, ids[2], "up");
    expect(await rowOf(ids[2])).toMatchObject({ position: 2 });
    expect(await rowOf(ids[1])).toMatchObject({ position: 3 });
  });

  test("moving past a different priority takes on that priority so the swap sticks", async () => {
    await setPriority(3, ids[0], "high");
    await moveEntry(3, ids[1], "up");
    expect(await lineOf(3)).toEqual([8, 7, 9]);
    expect((await rowOf(ids[1])).priority).toBe("high");
  });

  test("a new joiner goes behind a reordered line", async () => {
    await moveEntry(3, ids[2], "up");
    await joinQueue(10, { serviceId: 3 });
    expect(await lineOf(3)).toEqual([7, 9, 8, 10]);
  });

  test("409 at the front or the end, with the right wording", async () => {
    const front = await catchError(() => moveEntry(3, ids[0], "up"));
    expect(front.status).toBe(409);
    expect(front.message).toBe("That person is already at the front of the line.");

    const end = await catchError(() => moveEntry(3, ids[2], "down"));
    expect(end.status).toBe(409);
    expect(end.message).toBe("That person is already at the end of the line.");
  });

  test("400 for a bad direction with a readable message", async () => {
    const err = await catchError(() => moveEntry(3, ids[0], "sideways"));
    expect(err.status).toBe(400);
    expect(err.message).toBe("Direction must be \"up\" or \"down\".");
    expect(err.fields.direction).toBeDefined();
  });

  test("404 for someone not waiting here", async () => {
    expect((await catchError(() => moveEntry(3, 9999, "up"))).status).toBe(404);
  });
});

describe("admin queue routes", () => {
  const as = (id, req) => req.set("x-user-id", String(id));

  test("401 without a user and 403 for a normal user on every admin route", async () => {
    const calls = [
      (r) => r.get("/api/queues/3/entries"),
      (r) => r.post("/api/queues/3/serve-next"),
      (r) => r.delete(`/api/queues/3/entries/${ids[0]}`),
      (r) => r.patch(`/api/queues/3/entries/${ids[0]}`).send({ priority: "high" }),
      (r) => r.post(`/api/queues/3/entries/${ids[0]}/move`).send({ direction: "down" }),
    ];
    for (const call of calls) {
      expect((await call(request(app))).status).toBe(401);
      expect((await call(request(app)).set("x-user-id", "6")).status).toBe(403);
    }
  });

  test("admin lists entries and serves the next person", async () => {
    const list = await as(1, request(app).get("/api/queues/3/entries"));
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(3);

    const served = await as(1, request(app).post("/api/queues/3/serve-next"));
    expect(served.status).toBe(200);
    expect(served.body.servedEntry.userId).toBe(7);
    expect((await rowOf(ids[0])).status).toBe("served");
  });

  test("admin removes, reprioritizes and moves", async () => {
    const removed = await as(1, request(app).delete(`/api/queues/3/entries/${ids[0]}`));
    expect(removed.status).toBe(200);
    expect(removed.body.entries.map((e) => e.entry.userId)).toEqual([8, 9]);

    const raised = await as(1, request(app).patch(`/api/queues/3/entries/${ids[2]}`)).send({ priority: "high" });
    expect(raised.body.entries.map((e) => e.entry.userId)).toEqual([9, 8]);

    const moved = await as(1, request(app).post(`/api/queues/3/entries/${ids[1]}/move`)).send({ direction: "up" });
    expect(moved.body.entries.map((e) => e.entry.userId)).toEqual([8, 9]);
  });

  test("patch and move with no body are a 400, not a crash", async () => {
    const patch = await as(1, request(app).patch(`/api/queues/3/entries/${ids[0]}`));
    expect(patch.status).toBe(400);
    expect(patch.body.fields.priority).toBeDefined();

    const move = await as(1, request(app).post(`/api/queues/3/entries/${ids[0]}/move`));
    expect(move.status).toBe(400);
    expect(move.body.fields.direction).toBeDefined();
  });
});
