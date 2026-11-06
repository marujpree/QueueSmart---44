const request = require("supertest");
const app = require("../src/app");
const { query, resetTestDb } = require("../src/db/db");
const {
  listNotifications,
  addNotification,
  markAsRead,
  markAllAsRead,
  notifyJoined,
  notifyAlmostReady,
  notifyServed,
  notifyNewSignup,
  notifyRemoved,
} = require("../src/modules/notifications/notificationService");
const { catchError, count } = require("./helpers");

const admin = { id: 1, role: "admin" };
const demo = { id: 6, role: "user" };
const diego = { id: 3, role: "user" };

const valid = { audience: "user", userId: 3, type: "queue_update", title: "Hi", message: "Hello there." };

beforeEach(async () => {
  await resetTestDb();
});

describe("addNotification validation", () => {
  test("adds a valid user notification and saves it in the database", async () => {
    const n = await addNotification(valid);
    expect(n).toMatchObject({ id: 5, audience: "user", userId: 3, type: "queue_update", title: "Hi", message: "Hello there.", read: false });
    expect(new Date(n.createdAt).toISOString()).toBe(n.createdAt);
    const { rows } = await query("SELECT user_id, status, title FROM notifications WHERE id = 5");
    expect(rows[0]).toEqual({ user_id: 3, status: "sent", title: "Hi" });
  });

  test("admin notifications don't need or keep a userId", async () => {
    const n = await addNotification({ ...valid, audience: "admin", userId: undefined });
    expect(n.audience).toBe("admin");
    expect(n).not.toHaveProperty("userId");
  });

  test("trims title and message", async () => {
    const n = await addNotification({ ...valid, title: "  Hi  ", message: "  Hello.  " });
    expect(n.title).toBe("Hi");
    expect(n.message).toBe("Hello.");
  });

  test("rejects a bad audience", async () => {
    const err = await catchError(() => addNotification({ ...valid, audience: "everyone" }));
    expect(err.status).toBe(400);
    expect(err.fields.audience).toBeDefined();
  });

  test("rejects a user notification without a userId", async () => {
    const err = await catchError(() => addNotification({ ...valid, userId: undefined }));
    expect(err.fields.userId).toBe("User is required for a user notification.");
  });

  test("rejects a userId that doesn't exist", async () => {
    const err = await catchError(() => addNotification({ ...valid, userId: 999 }));
    expect(err.fields.userId).toBe("That user doesn't exist.");
    expect((await catchError(() => addNotification({ ...valid, userId: "abc" }))).fields.userId).toBe("That user doesn't exist.");
  });

  test("rejects a bad type", async () => {
    const err = await catchError(() => addNotification({ ...valid, type: "spam" }));
    expect(err.fields.type).toBeDefined();
  });

  test("title is required", async () => {
    expect((await catchError(() => addNotification({ ...valid, title: "" }))).fields.title).toBe("Title is required.");
    expect((await catchError(() => addNotification({ ...valid, title: "   " }))).fields.title).toBe("Title is required.");
    expect((await catchError(() => addNotification({ ...valid, title: 42 }))).fields.title).toBe("Title is required.");
  });

  test("title is limited to 100 characters", async () => {
    expect((await addNotification({ ...valid, title: "a".repeat(100) })).title).toHaveLength(100);
    const err = await catchError(() => addNotification({ ...valid, title: "a".repeat(101) }));
    expect(err.fields.title).toBeDefined();
  });

  test("message is required", async () => {
    expect((await catchError(() => addNotification({ ...valid, message: " " }))).fields.message).toBe("Message is required.");
  });

  test("message is limited to 300 characters", async () => {
    expect((await addNotification({ ...valid, message: "a".repeat(300) })).message).toHaveLength(300);
    const err = await catchError(() => addNotification({ ...valid, message: "a".repeat(301) }));
    expect(err.fields.message).toBeDefined();
  });

  test("an empty call reports every required field and saves nothing", async () => {
    const before = await count("notifications");
    const err = await catchError(() => addNotification());
    expect(Object.keys(err.fields).sort()).toEqual(["audience", "message", "title", "type"]);
    expect(await count("notifications")).toBe(before);
  });
});

describe("listNotifications", () => {
  test("admin gets only admin notifications, newest first", async () => {
    expect((await listNotifications("admin", 1)).map((n) => n.id)).toEqual([1, 2]);
  });

  test("user gets only their own, newest first", async () => {
    expect((await listNotifications("user", 6)).map((n) => n.id)).toEqual([3, 4]);
    expect(await listNotifications("user", 3)).toEqual([]);
  });

  test("two created at the same moment show the newer id first", async () => {
    const a = await addNotification({ ...valid, userId: 6 });
    const b = await addNotification({ ...valid, userId: 6 });
    await query("UPDATE notifications SET created_at = $1 WHERE id IN ($2, $3)", [a.createdAt, a.id, b.id]);
    expect((await listNotifications("user", 6)).slice(0, 2).map((n) => n.id)).toEqual([b.id, a.id]);
  });

  test("a new notification comes first", async () => {
    const n = await addNotification({ ...valid, userId: 6 });
    expect((await listNotifications("user", 6))[0].id).toBe(n.id);
  });

  test("seeded viewed notifications come back as read", async () => {
    const list = await listNotifications("user", 6);
    expect(list.map((n) => [n.id, n.read])).toEqual([[3, false], [4, true]]);
  });

  test("rejects a bad audience", async () => {
    expect((await catchError(() => listNotifications("nope", 6))).status).toBe(400);
  });
});

describe("markAsRead", () => {
  test("a user can mark their own", async () => {
    expect((await markAsRead(3, demo)).read).toBe(true);
    expect((await query("SELECT status FROM notifications WHERE id = 3")).rows[0].status).toBe("viewed");
  });

  test("a user can't mark someone else's", async () => {
    expect((await catchError(() => markAsRead(3, diego))).status).toBe(403);
    expect((await query("SELECT status FROM notifications WHERE id = 3")).rows[0].status).toBe("sent");
  });

  test("a user can't mark an admin one", async () => {
    expect((await catchError(() => markAsRead(1, demo))).status).toBe(403);
  });

  test("an admin can mark admin ones", async () => {
    expect((await markAsRead(1, admin)).read).toBe(true);
  });

  test("404 when it doesn't exist", async () => {
    const err = await catchError(() => markAsRead(999, demo));
    expect(err.status).toBe(404);
    expect(err.message).toBe("Notification not found.");
  });

  test("404 for an id too big for the database", async () => {
    expect((await catchError(() => markAsRead("99999999999", demo))).status).toBe(404);
  });
});

describe("markAllAsRead", () => {
  test("returns how many changed and only touches that user's", async () => {
    await addNotification({ ...valid, userId: 6 });
    await addNotification({ ...valid, userId: 3 });

    expect(await markAllAsRead("user", 6)).toBe(2);
    expect((await listNotifications("user", 6)).every((n) => n.read)).toBe(true);
    expect((await listNotifications("user", 3))[0].read).toBe(false);
    expect(await markAllAsRead("user", 6)).toBe(0);
  });

  test("admin marks all admin ones", async () => {
    expect(await markAllAsRead("admin", 1)).toBe(1);
  });

  test("rejects a bad audience", async () => {
    expect((await catchError(() => markAllAsRead("nope", 6))).status).toBe(400);
  });
});

describe("trigger helpers", () => {
  test("notifyJoined", async () => {
    expect(await notifyJoined(3, "Registrar", 4, 30)).toMatchObject({
      audience: "user",
      userId: 3,
      type: "queue_update",
      title: "You joined the queue",
      message: "You're #4 in line for Registrar, about 30 min wait.",
    });
  });

  test("notifyJoined uses you're next wording at position 1", async () => {
    expect((await notifyJoined(3, "Registrar", 1, 0)).message).toBe("You're next in line for Registrar.");
  });

  test("notifyAlmostReady", async () => {
    expect(await notifyAlmostReady(3, "Financial Aid")).toMatchObject({
      audience: "user",
      userId: 3,
      type: "status_change",
      title: "Almost your turn",
      message: "Head over to Financial Aid, you're almost up.",
    });
  });

  test("notifyServed", async () => {
    expect(await notifyServed(3, "Financial Aid")).toMatchObject({
      audience: "user",
      userId: 3,
      type: "status_change",
      title: "You've been served",
      message: "Thanks for visiting Financial Aid.",
    });
  });

  test("notifyRemoved", async () => {
    expect(await notifyRemoved(3, "Registrar")).toMatchObject({
      audience: "user",
      userId: 3,
      title: "Removed from the queue",
      message: "An admin removed you from the Registrar queue.",
    });
  });

  test("notifyNewSignup", async () => {
    const n = await notifyNewSignup("new.person@example.com");
    expect(n).toMatchObject({
      audience: "admin",
      type: "signup",
      title: "New user signed up",
      message: "new.person@example.com just created an account.",
    });
    expect(n).not.toHaveProperty("userId");
  });
});

describe("notification routes", () => {
  const as = (id, req) => req.set("x-user-id", String(id));

  test("401 without x-user-id", async () => {
    const res = await request(app).get("/api/notifications?audience=user");
    expect(res.status).toBe(401);
  });

  test("400 for a missing or bad audience", async () => {
    const missing = await as(6, request(app).get("/api/notifications"));
    const bad = await as(6, request(app).get("/api/notifications?audience=everyone"));
    expect(missing.status).toBe(400);
    expect(bad.status).toBe(400);
    expect(bad.body.fields.audience).toBeDefined();
  });

  test("403 when a normal user asks for admin", async () => {
    const res = await as(6, request(app).get("/api/notifications?audience=admin"));
    expect(res.status).toBe(403);
  });

  test("user gets their own list", async () => {
    const res = await as(6, request(app).get("/api/notifications?audience=user"));
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n) => n.id)).toEqual([3, 4]);
  });

  test("admin gets the admin list", async () => {
    const res = await as(1, request(app).get("/api/notifications?audience=admin"));
    expect(res.status).toBe(200);
    expect(res.body.notifications.map((n) => n.id)).toEqual([1, 2]);
  });

  test("mark one as read", async () => {
    const res = await as(6, request(app).patch("/api/notifications/3/read"));
    expect(res.status).toBe(200);
    expect(res.body.notification).toMatchObject({ id: 3, read: true });
  });

  test("mark read rejects a bad id, someone else's and a missing one", async () => {
    expect((await as(6, request(app).patch("/api/notifications/abc/read"))).status).toBe(400);
    expect((await as(6, request(app).patch("/api/notifications/0/read"))).status).toBe(400);
    expect((await as(3, request(app).patch("/api/notifications/3/read"))).status).toBe(403);
    expect((await as(6, request(app).patch("/api/notifications/999/read"))).status).toBe(404);
  });

  test("mark all as read", async () => {
    const res = await as(6, request(app).patch("/api/notifications/read-all?audience=user"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 1 });

    const list = await as(6, request(app).get("/api/notifications?audience=user"));
    expect(list.body.notifications.every((n) => n.read)).toBe(true);
  });

  test("mark all as read checks the audience too", async () => {
    expect((await as(6, request(app).patch("/api/notifications/read-all"))).status).toBe(400);
    expect((await as(6, request(app).patch("/api/notifications/read-all?audience=admin"))).status).toBe(403);
    expect((await as(1, request(app).patch("/api/notifications/read-all?audience=admin"))).body).toEqual({ updated: 1 });
  });
});
