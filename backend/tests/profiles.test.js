const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/app");
const { query, withTransaction } = require("../src/db/db");
const { resetStore } = require("../src/data/store");
const { getProfile, updateProfile } = require("../src/modules/profiles/service");
const { validateProfile, validatePreferences } = require("../src/modules/profiles/validation");

const valid = { firstName: "New", lastName: "Person", email: "new.person@example.com", password: "Password1", phone: "713-555-1234" };
const me = (method = "get", userId = 6) => request(app)[method]("/api/profiles/me").set("x-user-id", String(userId));
beforeEach(resetStore);

describe("profile persistence and account integration", () => {
  test("registration persists credentials and profile; login and GET work after memory resets", async () => {
    const created = await request(app).post("/api/auth/register").send({ ...valid, preferences: { contactMethod: "phone" } }).expect(201);
    const id = created.body.user.id;
    const credential = (await query("SELECT * FROM user_credentials WHERE id = $1", [id])).rows[0];
    expect(credential.password_hash).not.toBe(valid.password);
    expect(await bcrypt.compare(valid.password, credential.password_hash)).toBe(true);
    expect(await getProfile(id)).toEqual({ userId: id, fullName: "New Person", email: valid.email, phone: valid.phone, preferences: { contactMethod: "phone" } });
    resetStore();
    const login = await request(app).post("/api/auth/login").send({ email: valid.email, password: valid.password }).expect(200);
    expect(login.body.user.id).toBe(id);
    const profile = await me("get", id).expect(200);
    expect(profile.body.profile.fullName).toBe("New Person");
    expect(JSON.stringify(profile.body)).not.toMatch(/password/);
    await request(app).post("/api/queues/join").set("x-user-id", String(id)).send({ serviceId: 3 }).expect(201);
  });
  test("GET returns only the current profile", async () => {
    const res = await me().expect(200);
    expect(res.body.profile).toEqual({ userId: 6, fullName: "Demo Student", email: "demo.student@example.com", phone: null, preferences: {} });
  });
  test("PATCH trims and persists changes on a separate request and subsequent login", async () => {
    const saved = await me("patch").send({ fullName: "  Updated Student  ", phone: " +1 (713) 555-1234 ", preferences: { contactMethod: "phone" } }).expect(200);
    expect(saved.body.profile).toMatchObject({ fullName: "Updated Student", phone: "+1 (713) 555-1234", preferences: { contactMethod: "phone" } });
    resetStore();
    expect((await me().expect(200)).body).toEqual(saved.body);
    expect((await query("SELECT full_name FROM user_profiles WHERE user_id = 6")).rows[0].full_name).toBe("Updated Student");
    const login = await request(app).post("/api/auth/login").send({ email: "demo.student@example.com", password: "Password1" }).expect(200);
    expect(login.body.user.name).toBe("Updated Student");
    expect((await getProfile(3)).fullName).toBe("Diego Cepeda");
  });
  test("partial update preserves omitted fields; optional fields can be cleared", async () => {
    await updateProfile(6, { phone: valid.phone, preferences: { contactMethod: "phone" } });
    await updateProfile(6, { fullName: "Changed Name" });
    expect(await getProfile(6)).toMatchObject({ phone: valid.phone, preferences: { contactMethod: "phone" } });
    await me("patch").send({ phone: "", preferences: {} }).expect(200);
    expect(await getProfile(6)).toMatchObject({ fullName: "Changed Name", phone: null, preferences: {} });
  });
  test.each([undefined, "999", "abc", "0", "1.2", "2147483648"])("GET/PATCH reject absent or invalid account %s", async (id) => {
    for (const method of ["get", "patch"]) {
      let req = request(app)[method]("/api/profiles/me");
      if (id !== undefined) req = req.set("x-user-id", id);
      if (method === "patch") req = req.send({ fullName: "Name" });
      await req.expect(401);
    }
  });
  test("cannot choose another user or edit credential fields in the profile", async () => {
    await me("patch").send({ userId: 3, email: "other@example.com", role: "admin" }).expect(400);
    expect((await getProfile(3)).fullName).toBe("Diego Cepeda");
    await request(app).get("/api/profiles/3").set("x-user-id", "6").expect(404);
  });
  test("missing profiles return 404 from the service", async () => {
    await expect(getProfile(999)).rejects.toMatchObject({ status: 404 });
    await expect(updateProfile(999, { fullName: "Name" })).rejects.toMatchObject({ status: 404 });
  });
  test("never reads a stale store.users profile", async () => {
    const { store } = require("../src/data/store");
    store.users.find((u) => u.id === 6).name = "Stale cache";
    expect((await me().expect(200)).body.profile.fullName).toBe("Demo Student");
  });
});

describe("profile validation", () => {
  test.each([
    [{ fullName: "" }, "fullName"], [{ fullName: "   " }, "fullName"],
    [{ fullName: "A".repeat(101) }, "fullName"], [{ fullName: 123 }, "fullName"],
    [{ fullName: null }, "fullName"], [{ fullName: ["Name"] }, "fullName"], [{ fullName: "<script>" }, "fullName"],
    [{ phone: 7135551234 }, "phone"], [{ phone: "abc" }, "phone"], [{ phone: "1".repeat(21) }, "phone"],
    [{ phone: [] }, "phone"], [{ preferences: null }, "preferences"], [{ preferences: [] }, "preferences"],
    [{ preferences: "email" }, "preferences"], [{ preferences: { contactMethod: 1 } }, "preferences"],
    [{ preferences: { contactMethod: "sms" } }, "preferences"], [{ preferences: { contactMethod: null } }, "preferences"],
    [{ preferences: { unexpected: true } }, "preferences"], [{ unexpected: 1 }, "unexpected"], [{}, "body"],
  ])("rejects %j without changing data", async (body, field) => {
    const before = await getProfile(6);
    const res = await me("patch").send(body).expect(400);
    expect(res.body.fields[field]).toBeDefined();
    expect(await getProfile(6)).toEqual(before);
  });
  test("rejects missing or array bodies", async () => {
    await me("patch").expect(400);
    await me("patch").send([]).expect(400);
    expect(validateProfile(null).body).toBeDefined();
  });
  test("accepts boundary name length, Unicode, and absent phone", async () => {
    await me("patch").send({ fullName: "A".repeat(100), phone: null, preferences: { contactMethod: "email" } }).expect(200);
    await me("patch").send({ fullName: "Zoë O'Neil" }).expect(200);
  });
  test("phone preference requires a phone and cannot leave it empty later", async () => {
    expect((await me("patch").send({ preferences: { contactMethod: "phone" } }).expect(400)).body.fields.phone).toBeDefined();
    await me("patch").send({ phone: valid.phone, preferences: { contactMethod: "phone" } }).expect(200);
    await me("patch").send({ phone: null }).expect(400);
  });
  test("registration rejects overlong combined names and invalid preferences", async () => {
    await request(app).post("/api/auth/register").send({ ...valid, firstName: "A".repeat(50), lastName: "B".repeat(50) }).expect(400);
    await request(app).post("/api/auth/register").send({ ...valid, preferences: [] }).expect(400);
    expect(validatePreferences({ contactMethod: true })).toMatch(/email or phone/);
  });
});

describe("database profile constraints", () => {
  test.each([
    ["UPDATE user_profiles SET full_name = NULL WHERE user_id = 6", []],
    ["UPDATE user_profiles SET full_name = '  ' WHERE user_id = 6", []],
    ["UPDATE user_profiles SET full_name = $1 WHERE user_id = 6", ["A".repeat(101)]],
    ["UPDATE user_profiles SET phone = $1 WHERE user_id = 6", ["1".repeat(21)]],
    ["UPDATE user_profiles SET phone = 'abc' WHERE user_id = 6", []],
    ["UPDATE user_profiles SET preferences = NULL WHERE user_id = 6", []],
    ["UPDATE user_profiles SET preferences = $1 WHERE user_id = 6", [JSON.stringify([])]],
    ["UPDATE user_profiles SET preferences = $1 WHERE user_id = 6", [JSON.stringify({ contactMethod: 42 })]],
    ["UPDATE user_profiles SET email = 'other@example.com' WHERE user_id = 6", []],
    ["INSERT INTO user_profiles (user_id, email, full_name) VALUES (999, 'ghost@example.com', 'Ghost')", []],
    ["INSERT INTO user_profiles (user_id, email, full_name) VALUES (6, 'demo.student@example.com', 'Duplicate')", []],
    ["INSERT INTO user_credentials (email, password_hash) VALUES ('ADMIN@queuesmart.com', 'x')", []],
  ])("rejects invalid SQL writes %#", async (sql, params) => {
    await expect(query(sql, params)).rejects.toThrow();
  });
  test("rejects an email from another account even when its profile is absent", async () => {
    await query("DELETE FROM user_profiles WHERE user_id = 3");
    await expect(query("UPDATE user_profiles SET email = 'diego.cepeda@example.com' WHERE user_id = 6")).rejects.toThrow();
  });
  // PostgreSQL cascade behavior is covered in postgresProfiles.integration.cjs; pg-mem cannot emulate it.
  test("credential creation rolls back if the profile fails", async () => {
    await expect(withTransaction(async (client) => {
      const { rows } = await client.query("INSERT INTO user_credentials (email, password_hash) VALUES ('rollback@example.com', 'hash') RETURNING id");
      await client.query("INSERT INTO user_profiles (user_id, email, full_name) VALUES ($1, 'rollback@example.com', '')", [rows[0].id]);
    })).rejects.toThrow();
    expect((await query("SELECT * FROM user_credentials WHERE email = 'rollback@example.com'")).rowCount).toBe(0);
  });
});
