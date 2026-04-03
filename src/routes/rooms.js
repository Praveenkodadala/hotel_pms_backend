import express from 'express';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast, tenantOnly } from '../middleware/rbac.js';

const router = express.Router();
router.use(auth, tenantOnly, tenantScope);

// GET /api/rooms
router.get('/', async (req, res) => {
  try {
    let q = db('rooms').orderBy('floor').orderBy('number');
    if (req.tenantId) q = q.where({ tenant_id: req.tenantId });
    res.json(await q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms/availability?check_in=&check_out=
router.get('/availability', async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: 'check_in and check_out required' });
  try {
    // Rooms that have NO conflicting active reservation in the date range
    const bookedRoomIds = await db('reservations')
      .whereNotIn('status', ['cancelled', 'checked_out', 'no_show'])
      .where('check_in', '<', check_out)
      .andWhere('check_out', '>', check_in)
      .pluck('room_id');

    let q = db('rooms').where({ status: 'available', housekeeping_status: 'clean' })
      .whereNotIn('id', bookedRoomIds)
      .orderBy('floor').orderBy('number');
    if (req.tenantId) q = q.where({ tenant_id: req.tenantId });
    res.json(await q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms/:id
router.get('/:id', async (req, res) => {
  try {
    let q = db('rooms').where({ id: req.params.id });
    if (req.tenantId) q = q.andWhere({ tenant_id: req.tenantId });
    const room = await q.first();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rooms
router.post('/', atLeast('manager'), async (req, res) => {
  const { number, type, floor, max_occupancy, base_rate, description } = req.body;
  if (!number || !type || !base_rate) return res.status(400).json({ error: 'number, type, base_rate required' });
  try {
    // Unique within tenant
    const exists = await db('rooms').where({ number, tenant_id: req.tenantId || null }).first();
    if (exists) return res.status(409).json({ error: `Room ${number} already exists` });
    const [room] = await db('rooms').insert({
      tenant_id: req.tenantId || null,
      number, type, floor: floor || 1,
      max_occupancy: max_occupancy || 2,
      base_rate, description: description || null,
      status: 'available', housekeeping_status: 'clean',
    }).returning('*');
    res.status(201).json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/rooms/:id
router.put('/:id', atLeast('manager'), async (req, res) => {
  try {
    // Strip fields that should not be updated directly via this route
    const { tenant_id, id, created_at, ...safeFields } = req.body;
    const [room] = await db('rooms')
      .where({ id: req.params.id, tenant_id: req.tenantId || null })
      .update({ ...safeFields, updated_at: new Date() }).returning('*');
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rooms/:id
router.delete('/:id', atLeast('hotel_admin'), async (req, res) => {
  try {
    const room = await db('rooms').where({ id: req.params.id, tenant_id: req.tenantId || null }).first();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status === 'occupied') return res.status(400).json({ error: 'Cannot delete occupied room' });
    await db('rooms').where({ id: req.params.id }).del();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rooms/:id/close — inventory closure
router.post('/:id/close', atLeast('manager'), async (req, res) => {
  const { from_date, to_date, reason } = req.body;
  if (!from_date || !to_date) return res.status(400).json({ error: 'from_date and to_date required' });
  try {
    const room = await db('rooms').where({ id: req.params.id, tenant_id: req.tenantId || null }).first();
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const [closure] = await db('inventory_closures').insert({
      room_id: req.params.id, from_date, to_date,
      reason: reason || 'Maintenance', created_by: req.user.id,
    }).returning('*');
    await db('rooms').where({ id: req.params.id }).update({ status: 'closed', updated_at: new Date() });
    res.status(201).json(closure);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/rooms/:id/close/:closureId — lift closure
router.delete('/:id/close/:closureId', atLeast('manager'), async (req, res) => {
  try {
    await db('inventory_closures').where({ id: req.params.closureId, room_id: req.params.id }).del();
    await db('rooms').where({ id: req.params.id }).update({ status: 'available', updated_at: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms/:id/closures
router.get('/:id/closures', async (req, res) => {
  try {
    const closures = await db('inventory_closures').where({ room_id: req.params.id }).orderBy('from_date');
    res.json(closures);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
