jest.mock("../src/modules/notifications/notificationService", () => {
  const actual = jest.requireActual("../src/modules/notifications/notificationService");
  return { ...actual, notifyNewSignup: jest.fn(actual.notifyNewSignup) };
});
const request = require("supertest");
const app = require("../src/app");
const { query } = require("../src/db/db");
const { store, resetStore } = require("../src/data/store");
const { notifyNewSignup } = require("../src/modules/notifications/notificationService");

beforeEach(() => {
  resetStore();
});

const valid = { firstName: "New", lastName: "Person", email: "new.person@example.com", password: "Password1" };

describe("POST /api/auth/register", () => {
  test("creates a user account and returns it without the password", async () => {
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: 7,
      name: "New Person",
      preferences: {},
      email: "new.person@example.com",
      phone: "",
      role: "user",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect((await query("SELECT * FROM user_profiles")).rowCount).toBe(7);
  });

  test("tells the admins about the new signup", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const { rows } = await query("SELECT message FROM notifications WHERE type = 'signup' ORDER BY id DESC LIMIT 1");
    expect(rows[0].message).toBe("new.person@example.com just created an account.");
  });

  test("still creates the account when the signup notification fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    notifyNewSignup.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
    expect((await query("SELECT 1 FROM user_credentials WHERE email = $1", [valid.email])).rowCount).toBe(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("lowercases the email and trims the names", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, firstName: "  Jane ", lastName: " Doe  ", email: "  Jane@Example.com " });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "jane@example.com", name: "Jane Doe" });
  });

  test("saves an optional phone number", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, phone: " 713-555-1234 " });
    expect(res.status).toBe(201);
    expect(res.body.user.phone).toBe("713-555-1234");
  });

  test("ignores a role sent by the client", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, role: "admin" });
    expect(res.body.user.role).toBe("user");
  });

  test("returns 400 with field errors for invalid input", async () => {
    const res = await request(app).post("/api/auth/register").send({ firstName: "", email: "bad", password: "short", phone: "abc" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "firstName", "lastName", "password", "phone"]);
    expect((await query("SELECT * FROM user_profiles")).rowCount).toBe(6);
  });

  test("returns 400 when there is no body at all", async () => {
    const res = await request(app).post("/api/auth/register");
    expect(res.status).toBe(400);
    expect(res.body.fields.email).toBeDefined();
  });

  test("returns 409 for a duplicate email, ignoring case", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, email: "ADMIN@queuesmart.com" });
    expect(res.status).toBe(409);
    expect((await query("SELECT * FROM user_profiles")).rowCount).toBe(6);
  });
});

describe("POST /api/auth/login", () => {
  test("signs in the seeded admin", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "admin@queuesmart.com", password: "Admin1234" });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, name: "Admin", email: "admin@queuesmart.com", phone: "", preferences: {}, role: "admin" });
  });

  test("signs in a seeded user, ignoring email case", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "Demo.Student@example.com", password: "Password1" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: 6, role: "user" });
  });

  test("signs in someone who just registered", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const res = await request(app).post("/api/auth/login").send({ email: valid.email, password: valid.password });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(7);
  });

  test("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email: "admin@queuesmart.com", password: "Wrong1234" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "Password1" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  test("returns 400 for missing fields", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "password"]);
  });

  test("returns 400 when there is no body at all", async () => {
    const res = await request(app).post("/api/auth/login");
    expect(res.status).toBe(400);
  });
});
