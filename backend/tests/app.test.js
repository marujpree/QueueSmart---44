jest.mock("../src/db/db", () => {
  const actual = jest.requireActual("../src/db/db");
  return { ...actual, query: jest.fn(actual.query), withTransaction: jest.fn(actual.withTransaction) };
});

const request = require("supertest");
const app = require("../src/app");
const { resetStore } = require("../src/data/store");
const { query, resetTestDb } = require("../src/db/db");
const { currentUser, requireUser, requireAdmin } = require("../src/middleware/currentUser");
const { HttpError, badRequest, unauthorized, forbidden, notFound, conflict } = require("../src/utils/httpError");

beforeEach(async () => {
  resetStore();
  await resetTestDb();
});

const makeReq = (headers = {}) => ({
  get: (name) => headers[name.toLowerCase()],
});

describe("app", () => {
  test("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test("unknown route returns 404 json", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Route not found." });
  });

  test("anything that isn't an HttpError returns a generic 500", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app)
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong." });
    spy.mockRestore();
  });

  test("allows the vite dev server origin", async () => {
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("httpError helpers", () => {
  test("each helper sets the right status", () => {
    expect(badRequest().status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict().status).toBe(409);
    expect(conflict("Already in line.")).toBeInstanceOf(HttpError);
    expect(conflict("Already in line.").message).toBe("Already in line.");
  });
});

describe("currentUser middleware", () => {
  test("sets req.user from x-user-id", async () => {
    const req = makeReq({ "x-user-id": "3" });
    const next = jest.fn();
    await currentUser(req, {}, next);
    expect(req.user).toMatchObject({ id: 3, name: "Diego Cepeda", role: "user" });
    expect(next).toHaveBeenCalledWith();
  });

  test("sets req.user to null with no header", async () => {
    const req = makeReq();
    await currentUser(req, {}, jest.fn());
    expect(req.user).toBeNull();
  });

  test("sets req.user to null for an unknown or bad id", async () => {
    const unknown = makeReq({ "x-user-id": "999" });
    const bad = makeReq({ "x-user-id": "abc" });
    const negative = makeReq({ "x-user-id": "-1" });
    await currentUser(unknown, {}, jest.fn());
    await currentUser(bad, {}, jest.fn());
    await currentUser(negative, {}, jest.fn());
    expect(unknown.user).toBeNull();
    expect(bad.user).toBeNull();
    expect(negative.user).toBeNull();
  });

  test("never loads the password hash", async () => {
    const req = makeReq({ "x-user-id": "1" });
    await currentUser(req, {}, jest.fn());
    expect(req.user).toEqual({ id: 1, email: "admin@queuesmart.com", role: "admin", name: "Admin" });
  });

  test("passes a database error to next", async () => {
    const err = new Error("db down");
    query.mockRejectedValueOnce(err);
    const next = jest.fn();
    await currentUser(makeReq({ "x-user-id": "3" }), {}, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test("requireUser passes a 401 when nobody is signed in", () => {
    const next = jest.fn();
    requireUser({ user: null }, {}, next);
    expect(next.mock.calls[0][0].status).toBe(401);
  });

  test("requireUser lets a user through", () => {
    const next = jest.fn();
    requireUser({ user: { id: 6, role: "user" } }, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  test("requireAdmin gives 401 for nobody, 403 for a user, passes an admin", () => {
    const nobody = jest.fn();
    const user = jest.fn();
    const admin = jest.fn();
    requireAdmin({ user: null }, {}, nobody);
    requireAdmin({ user: { id: 6, role: "user" } }, {}, user);
    requireAdmin({ user: { id: 1, role: "admin" } }, {}, admin);
    expect(nobody.mock.calls[0][0].status).toBe(401);
    expect(user.mock.calls[0][0].status).toBe(403);
    expect(admin).toHaveBeenCalledWith();
  });
});
