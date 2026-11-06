const request = require('supertest');
const app = require('../src/app');
const { store, resetStore } = require('../src/data/store');
const { resetTestDb } = require('../src/db/db');
const valid = { name: 'Career Coaching', description: 'Help with resumes and interviews.', durationMinutes: 20, priority: 'medium' };
const admin = req => req.set('x-user-id', '1');
const user = req => req.set('x-user-id', '6');
beforeEach(async () => {
  resetStore();
  await resetTestDb();
});

test('admin-created service is returned to a separate user and has an empty queue', async () => {
  const created = await admin(request(app).post('/api/services')).send(valid);
  expect(created.status).toBe(201);
  expect(created.body.service).toEqual({ id: 5, ...valid, isOpen: true });
  expect(store.queues[5]).toEqual([]);
  const listed = await user(request(app).get('/api/services'));
  expect(listed.status).toBe(200);
  expect(listed.body.services).toContainEqual(created.body.service);
  expect(listed.headers['cache-control']).toBe('no-store');
  const detail = await user(request(app).get('/api/services/5'));
  expect(detail.body.service).toEqual(created.body.service);
});

test('service edits and open/close changes are visible to users', async () => {
  const changed = await admin(request(app).patch('/api/services/1')).send({ name: 'Updated advising', isOpen: false });
  expect(changed.status).toBe(200);
  expect(changed.body.service).toMatchObject({ id: 1, name: 'Updated advising', isOpen: false, durationMinutes: 15 });
  const detail = await user(request(app).get('/api/services/1'));
  expect(detail.body.service).toEqual(changed.body.service);
  expect((await admin(request(app).patch('/api/services/1')).send({ isOpen: true })).body.service.isOpen).toBe(true);
});

test.each(['get', 'post', 'patch'])('%s requires a signed-in user', async method => {
  const path = method === 'patch' ? '/api/services/1' : '/api/services';
  const res = await request(app)[method](path).send(valid);
  expect(res.status).toBe(401);
});

test.each(['post', 'patch'])('ordinary users cannot %s services', async method => {
  const path = method === 'patch' ? '/api/services/1' : '/api/services';
  expect((await user(request(app)[method](path)).send(valid)).status).toBe(403);
  expect(store.services).toHaveLength(4);
});

test.each([
  [{ name: '' }, 'name'], [{ name: 'a'.repeat(101) }, 'name'],
  [{ name: 42 }, 'name'], [{ description: ' ' }, 'description'],
  [{ description: 'a'.repeat(501) }, 'description'],
  [{ durationMinutes: 0 }, 'durationMinutes'], [{ durationMinutes: 481 }, 'durationMinutes'],
  [{ durationMinutes: 2.5 }, 'durationMinutes'], [{ durationMinutes: '20' }, 'durationMinutes'],
  [{ durationMinutes: true }, 'durationMinutes'], [{ priority: 'urgent' }, 'priority'],
  [{ isOpen: 'false' }, 'isOpen'], [{ id: 99 }, 'id'],
])('invalid input %j returns field errors without modifying data', async (change, field) => {
  const res = await admin(request(app).post('/api/services')).send({ ...valid, ...change });
  expect(res.status).toBe(400);
  expect(res.body.fields[field]).toBeDefined();
  expect(store.services).toHaveLength(4);
  expect(Object.keys(store.queues)).toHaveLength(4);
});

test('missing and malformed service bodies return 400', async () => {
  expect((await admin(request(app).post('/api/services'))).status).toBe(400);
  expect((await admin(request(app).post('/api/services')).send([])).status).toBe(400);
  expect((await admin(request(app).patch('/api/services/1')).send({})).status).toBe(400);
});

test('normalizes text and rejects duplicate names ignoring case and whitespace', async () => {
  const created = await admin(request(app).post('/api/services')).send({ ...valid, name: '  Career Coaching  ', description: '  Advice  ' });
  expect(created.body.service).toMatchObject({ name: valid.name, description: 'Advice' });
  const duplicate = await admin(request(app).post('/api/services')).send({ ...valid, name: ' career COACHING ' });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.fields.name).toBeDefined();
});

test('editing keeps its own name but cannot take another service name', async () => {
  expect((await admin(request(app).patch('/api/services/1')).send({ name: 'academic advising' })).status).toBe(200);
  const res = await admin(request(app).patch('/api/services/1')).send({ name: 'Financial Aid', isOpen: false });
  expect(res.status).toBe(409);
  expect(store.services[0].isOpen).toBe(true);
});

test.each(['999', 'abc', '-1', '1.5'])('unknown service %s returns 404', async id => {
  expect((await user(request(app).get(`/api/services/${id}`))).status).toBe(404);
  expect((await admin(request(app).patch(`/api/services/${id}`)).send({ isOpen: false })).status).toBe(404);
});

test('successive creates allocate distinct server IDs', async () => {
  const one = await admin(request(app).post('/api/services')).send(valid);
  const two = await admin(request(app).post('/api/services')).send({ ...valid, name: 'Tutoring' });
  expect(two.body.service.id).toBe(one.body.service.id + 1);
});
