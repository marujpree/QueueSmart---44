jest.mock("../src/db/db", () => {
  const actual = jest.requireActual("../src/db/db");
  return { ...actual, query: jest.fn(actual.query), withTransaction: jest.fn(actual.withTransaction) };
});

const request = require("supertest");
const app = require("../src/app");
const bcrypt = require("bcryptjs");
const { query, resetTestDb, withTransaction } = require("../src/db/db");
const { count } = require("./helpers");

beforeEach(async () => {
  await resetTestDb();
});

const valid = { firstName: "New", lastName: "Person", email: "new.person@example.com", password: "Password1" };

describe("POST /api/auth/register", () => {
  test("creates a user account and returns it without the password", async () => {
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: 7,
      name: "New Person",
      firstName: "New",
      lastName: "Person",
      email: "new.person@example.com",
      phone: "",
      role: "user",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect(await count("user_credentials")).toBe(7);
    expect(await count("user_profiles")).toBe(7);
  });

  test("stores a bcrypt hash, never the plain password", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const { rows } = await query("SELECT password_hash, role FROM user_credentials WHERE email = $1", [valid.email]);
    expect(rows[0].role).toBe("user");
    expect(rows[0].password_hash).not.toContain(valid.password);
    expect(await bcrypt.compare(valid.password, rows[0].password_hash)).toBe(true);
  });

  test("saves the profile with the full name and phone", async () => {
    await request(app).post("/api/auth/register").send({ ...valid, phone: "713-555-1234" });
    const { rows } = await query("SELECT full_name, phone FROM user_profiles WHERE email = $1", [valid.email]);
    expect(rows[0]).toEqual({ full_name: "New Person", phone: "713-555-1234" });
  });

  test("tells the admins about the new signup", async () => {
    await request(app).post("/api/auth/register").send(valid);
    const { rows } = await query("SELECT message FROM notifications WHERE type = 'signup' ORDER BY id DESC LIMIT 1");
    expect(rows[0].message).toBe("new.person@example.com just created an account.");
  });

  test("still creates the account when the signup notification fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const notifications = require("../src/modules/notifications/notificationService");
    const fail = jest.spyOn(notifications, "notifyNewSignup").mockRejectedValue(new Error("boom"));
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(201);
    fail.mockRestore();
    spy.mockRestore();
  });

  test("returns 400 when first and last name together are over 100 characters", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, firstName: "a".repeat(50), lastName: "b".repeat(50) });
    expect(res.status).toBe(400);
    expect(res.body.fields.lastName).toMatch(/100/);
  });

  test("a duplicate that slips past the check still comes back as 409", async () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    withTransaction.mockRejectedValueOnce(err);
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(409);
  });

  test("any other database error is a 500", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    withTransaction.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).post("/api/auth/register").send(valid);
    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  test("lowercases the email and trims the names", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...valid, firstName: "  Jane ", lastName: " Doe  ", email: "  Jane@Example.com " });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "jane@example.com", name: "Jane Doe", firstName: "Jane", lastName: "Doe" });
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
    expect(await count("user_credentials")).toBe(6);
  });

  test("returns 400 when there is no body at all", async () => {
    const res = await request(app).post("/api/auth/register");
    expect(res.status).toBe(400);
    expect(res.body.fields.email).toBeDefined();
  });

  test("returns 409 for a duplicate email, ignoring case", async () => {
    const res = await request(app).post("/api/auth/register").send({ ...valid, email: "ADMIN@queuesmart.com" });
    expect(res.status).toBe(409);
    expect(await count("user_credentials")).toBe(6);
  });
});

describe("POST /api/auth/login", () => {
  test("signs in the seeded admin", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "admin@queuesmart.com", password: "Admin1234" });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 1, name: "Admin", firstName: "Admin", lastName: "", email: "admin@queuesmart.com", phone: "", role: "admin" });
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
