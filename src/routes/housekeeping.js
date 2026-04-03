import express from 'express';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast, roles } from '../middleware/rbac.js'


const router = express.Router();
router.use(auth, tenantScope);

// ── GET /api/housekeeping — list tasks ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, assigned_to, priority } = req.query;
    let q = db('housekeeping_tasks as ht')
      .join('rooms as r', 'ht.room_id', 'r.id')
      .leftJoin('users as u', 'ht.assigned_to', 'u.id')
      .leftJoin('reservations as res', 'ht.reservation_id', 'res.id')
      .select(
        'ht.*',
        'r.number as room_number', 'r.type as room_type', 'r.floor',
        'r.housekeeping_status as room_hk_status',
        'u.name as assigned_to_name',
        db.raw("CONCAT(res.first_name, ' ', res.last_name) as last_guest")
      )
      .orderBy('ht.created_at', 'desc');

    if (req.tenantId) q = q.where('ht.tenant_id', req.tenantId);
    if (status) q = q.where('ht.status', status);
    if (assigned_to) q = q.where('ht.assigned_to', assigned_to);
    if (priority) q = q.where('ht.priority', priority);

    res.json(await q);
  } catch (e) {
    console.error('[GET /housekeeping]', e.message);
    res.status(500).json({ error: 'Failed to fetch tasks', detail: e.message });
  }
});

// ── GET /api/housekeeping/staff — list HK staff for assignment ─────
router.get('/staff', async (req, res) => {
  try {
    let q = db('users')
      .where({ role: 'housekeeping' })
      .select('id', 'name', 'email', 'status');
    if (req.tenantId) q = q.where({ tenant_id: req.tenantId });
    res.json(await q);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch staff', detail: e.message });
  }
});

// ── GET /api/housekeeping/:id — single task ────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const task = await db('housekeeping_tasks as ht')
      .join('rooms as r', 'ht.room_id', 'r.id')
      .leftJoin('users as u', 'ht.assigned_to', 'u.id')
      .leftJoin('users as cb', 'ht.created_by', 'cb.id')
      .leftJoin('users as ib', 'ht.inspected_by', 'ib.id')
      .select(
        'ht.*',
        'r.number as room_number', 'r.type as room_type', 'r.floor', 'r.housekeeping_status',
        'u.name as assigned_to_name', 'u.email as assigned_to_email',
        'cb.name as created_by_name',
        'ib.name as inspected_by_name'
      )
      .where('ht.id', req.params.id)
      .first();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch task', detail: e.message });
  }
});

// ── POST /api/housekeeping — create task manually ──────────────────
router.post('/', atLeast('receptionist'), async (req, res) => {
  const { room_id, priority, notes, assigned_to } = req.body;
  if (!room_id) return res.status(400).json({ error: 'room_id required' });
  try {
    const room = await db('rooms').where({ id: room_id }).first();
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const [task] = await db('housekeeping_tasks').insert({
      tenant_id: req.tenantId || null,
      room_id,
      assigned_to: assigned_to || null,
      created_by: req.user.id,
      status: assigned_to ? 'assigned' : 'pending',
      priority: priority || 'normal',
      notes: notes || null,
    }).returning('*');

    // Mark room dirty
    await db('rooms').where({ id: room_id }).update({
      housekeeping_status: 'dirty',
      assigned_hk_user: assigned_to || null,
      updated_at: new Date(),
    });

    res.status(201).json(task);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create task', detail: e.message });
  }
});

// ── PATCH /api/housekeeping/:id/assign ────────────────────────────
router.patch('/:id/assign', atLeast('manager'), async (req, res) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return res.status(400).json({ error: 'assigned_to required' });
  try {
    const [task] = await db('housekeeping_tasks').where({ id: req.params.id })
      .update({ assigned_to, status: 'assigned', updated_at: new Date() }).returning('*');
    if (!task) return res.status(404).json({ error: 'Task not found' });
    await db('rooms').where({ id: task.room_id }).update({ assigned_hk_user: assigned_to, updated_at: new Date() });
    res.json(task);
  } catch (e) {
    res.status(500).json({ error: 'Failed to assign task', detail: e.message });
  }
});

// ── PATCH /api/housekeeping/:id/start ─────────────────────────────
// Housekeeping staff marks task as in-progress
router.patch('/:id/start', roles('housekeeping', 'manager', 'hotel_admin', 'super_admin'), async (req, res) => {
  try {
    const task = await db('housekeeping_tasks').where({ id: req.params.id }).first();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!['pending', 'assigned'].includes(task.status))
      return res.status(400).json({ error: `Cannot start task with status '${task.status}'` });

    const [updated] = await db('housekeeping_tasks').where({ id: req.params.id })
      .update({ status: 'in_progress', started_at: new Date(), updated_at: new Date() }).returning('*');

    await db('rooms').where({ id: task.room_id }).update({
      status: 'maintenance',
      housekeeping_status: 'in_progress',
      hk_started_at: new Date(),
      updated_at: new Date(),
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to start task', detail: e.message });
  }
});

// ── PATCH /api/housekeeping/:id/complete ──────────────────────────
// Housekeeping staff marks task complete (awaiting inspection)
router.patch('/:id/complete', roles('housekeeping', 'manager', 'hotel_admin', 'super_admin'), async (req, res) => {
  const { completion_notes, checklist } = req.body;
  try {
    const task = await db('housekeeping_tasks').where({ id: req.params.id }).first();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'in_progress')
      return res.status(400).json({ error: `Task must be in_progress to complete (current: ${task.status})` });

    const [updated] = await db('housekeeping_tasks').where({ id: req.params.id })
      .update({
        status: 'completed',
        completion_notes: completion_notes || null,
        checklist: checklist ? JSON.stringify(checklist) : task.checklist,
        completed_at: new Date(),
        updated_at: new Date(),
      }).returning('*');

    await db('rooms').where({ id: task.room_id }).update({
      hk_completed_at: new Date(),
      updated_at: new Date(),
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to complete task', detail: e.message });
  }
});

// ── PATCH /api/housekeeping/:id/inspect ───────────────────────────
// Supervisor/manager approves → room becomes AVAILABLE
router.patch('/:id/inspect', atLeast('manager'), async (req, res) => {
  try {
    const task = await db('housekeeping_tasks').where({ id: req.params.id }).first();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!['completed', 'in_progress'].includes(task.status))
      return res.status(400).json({ error: `Task must be completed before inspection (current: ${task.status})` });

    const [updated] = await db('housekeeping_tasks').where({ id: req.params.id })
      .update({
        status: 'inspected',
        inspected_at: new Date(),
        inspected_by: req.user.id,
        updated_at: new Date(),
      }).returning('*');

    // ✅ Room is now available for booking again
    await db('rooms').where({ id: task.room_id }).update({
      status: 'available',
      housekeeping_status: 'clean',
      assigned_hk_user: null,
      hk_started_at: null,
      hk_completed_at: null,
      updated_at: new Date(),
    });

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to inspect task', detail: e.message });
  }
});

// ── PATCH /api/housekeeping/:id/cancel ────────────────────────────
router.patch('/:id/cancel', atLeast('manager'), async (req, res) => {
  try {
    const task = await db('housekeeping_tasks').where({ id: req.params.id }).first();
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const [updated] = await db('housekeeping_tasks').where({ id: req.params.id })
      .update({ status: 'cancelled', updated_at: new Date() }).returning('*');

    // If room was locked, release it
    const room = await db('rooms').where({ id: task.room_id }).first();
    if (room && room.status === 'maintenance') {
      await db('rooms').where({ id: task.room_id }).update({
        status: 'available', housekeeping_status: 'clean',
        assigned_hk_user: null, updated_at: new Date(),
      });
    }
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to cancel task', detail: e.message });
  }
});

export default router;
