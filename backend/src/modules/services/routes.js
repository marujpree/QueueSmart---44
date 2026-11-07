const express = require('express');
const { requireUser, requireAdmin } = require('../../middleware/currentUser');
const { listServices, getService, createService, updateService, deleteService } = require('./service');
const router = express.Router();

router.get('/', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ services: await listServices() });
});
router.get('/:id', requireUser, async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ service: await getService(req.params.id) });
});
router.post('/', requireAdmin, async (req, res) => {
  res.status(201).json({ service: await createService(req.body) });
});
router.patch('/:id', requireAdmin, async (req, res) => {
  res.json({ service: await updateService(req.params.id, req.body) });
});
router.delete('/:id', requireAdmin, async (req, res) => {
  res.json(await deleteService(req.params.id));
});

module.exports = router;
