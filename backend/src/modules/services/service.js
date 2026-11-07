const { query, withTransaction } = require('../../db/db');
const { notFound, conflict } = require('../../utils/httpError');
const { validateService } = require('./validation');

const SELECT_SERVICE = `
  SELECT s.id, s.name, s.description, s.duration_minutes, s.priority,
        q.status = 'open' AS is_open
  FROM services s
  JOIN queues q ON q.service_id = s.id
  `;

  const toService = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    priority: row.priority,
    isOpen: row.is_open,
  });

  const asConflict = (err) => {
    if (err.code === '23505') {
      const error = conflict('A service with this name already exists.');
      error.fields = { name: error.message };
      return error;
    }
    return err;
  };

  const assertNameIsFree = async (client, name, ignoreId = 0) => {
    const { rows } = await client.query(
      'SELECT 1 FROM services WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1',
      [name, ignoreId]
    );
    if (rows.length > 0) {
      const error = conflict('A service with this name already exists.');
      error.fields = { name: error.message };
      throw error;
    }
  };

const listServices = async () => {
  const { rows } = await query(`${SELECT_SERVICE} ORDER BY s.id`);
  return rows.map(toService);
};

const getService = async (id) => {
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) throw notFound('Service not found.');
  const { rows } = await query (`${SELECT_SERVICE} WHERE s.id = $1`, [numericId]);
  if (rows.length === 0) throw notFound('Service not found.');
  return toService(rows[0]);
};

const createService = async (body) => {
  const values = validateService(body);
  try {
    return await withTransaction(async (client) => {
      await assertNameIsFree(client, values.name);
      const { rows } = await client.query(
        `INSERT INTO services (name, description, duration_minutes, priority)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, description, duration_minutes, priority`,
        [values.name, values.description, values.durationMinutes, values.priority]
      );
      await client.query('INSERT INTO queues (service_id, status) VALUES ($1, $2)', [
        rows[0].id,
        values.isOpen ? 'open' : 'closed',
      ]);
      return toService({ ...rows[0], is_open: values.isOpen });
    });
  } catch (err) {
    throw asConflict(err);
  }
};

const updateService = async (id, body) => {
  const existing = await getService(id);
  const values = validateService(body, existing);
  try{
    return await withTransaction(async (client) => {
      await assertNameIsFree(client, values.name, existing.id);
      await client.query(
        `UPDATE services SET name =$1, description = $2, duration_minutes = $3, priority =$4
        WHERE id = $5`,
        [values.name, values.description, values.durationMinutes, values.priority, existing.id]
      );
      await client.query('UPDATE queues SET status = $1 WHERE service_id = $2', [
        values.isOpen ? 'open' : 'closed',
        existing.id,
      ]);
      return { id: existing.id, ...values };
    });
  } catch (err) {
    throw asConflict(err);
  }
};

const deleteService = async (id) => {
  const existing = await getService(id);
  return withTransaction (async (client) => {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n
      FROM queue_entries e JOIN queues q ON q.id = e.queue_id
      WHERE q.service_id = $1 AND e.status = 'waiting'`,
      [existing.id]
    );
    if (rows[0].n > 0) {
      throw conflict('This service still has people waiting. Serve or remove them first.');
    }
    await client.query('DELETE FROM services WHERE id = $1', [existing.id]);
    return { deleted: true, id: existing.id, name: existing.name };
  });
};

module.exports = { listServices, getService, createService, updateService, deleteService };
