const { badRequest } = require('../../utils/httpError');

// Validate again on the server; browser validation can be bypassed.
const validateService = (body, existing = null) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Service details must be an object.');
  }
  const allowed = ['name', 'description', 'durationMinutes', 'priority', 'isOpen'];
  const fields = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = 'Unknown service field.';
  }
  if (existing && Object.keys(body).length === 0) {
    throw badRequest('Provide at least one service field.');
  }
  const values = { ...existing, ...body };
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const description = typeof values.description === 'string' ? values.description.trim() : '';
  if (!name || name.length > 100) fields.name = 'Service name is required and must be 100 characters or less.';
  if (!description || description.length > 500) fields.description = 'Description is required and must be 500 characters or less.';
  if (typeof values.durationMinutes !== 'number' || !Number.isInteger(values.durationMinutes) || values.durationMinutes < 1 || values.durationMinutes > 480) {
    fields.durationMinutes = 'Expected duration must be a whole number between 1 and 480 minutes.';
  }
  if (!['low', 'medium', 'high'].includes(values.priority)) fields.priority = 'Choose low, medium, or high priority.';
  const isOpen = values.isOpen === undefined ? true : values.isOpen;
  if (typeof isOpen !== 'boolean') fields.isOpen = 'Open status must be true or false.';
  if (Object.keys(fields).length) throw badRequest('Please fix the highlighted fields.', fields);
  
  return { name, description, durationMinutes: values.durationMinutes, priority: values.priority, isOpen };
};

module.exports = { validateService };