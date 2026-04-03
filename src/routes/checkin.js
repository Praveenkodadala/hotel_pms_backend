import express from 'express';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast, tenantOnly } from '../middleware/rbac.js';
import { createInvoice } from '../services/invoiceService.js';

const router = express.Router();
router.use(auth, tenantOnly, tenantScope);

// ── POST /api/checkin/:reservation_id ──────────────────────────────
router.post('/:reservation_id', atLeast('receptionist'), async (req, res) => {
  const { id_type, id_number, notes } = req.body;
  if (!id_type || !id_number)
    return res.status(400).json({ error: 'id_type and id_number required' });

  try {
    const r = await db('reservations').where({ id: req.params.reservation_id }).first();
    if (!r) return res.status(404).json({ error: 'Reservation not found' });
    if (r.status !== 'confirmed')
      return res.status(400).json({ error: `Cannot check in — reservation status is '${r.status}'` });

    const [updated] = await db('reservations')
      .where({ id: r.id })
      .update({
        status:         'checked_in',
        id_type,
        id_number,
        actual_check_in: new Date(),
        notes:           notes || r.notes,
        checked_in_by:   req.user.id,
        updated_at:      new Date(),
      })
      .returning('*');

    await db('rooms').where({ id: r.room_id }).update({
      status:               'occupied',
      housekeeping_status:  'dirty',
      updated_at:            new Date(),
    });

    res.json({ success: true, reservation: updated });
  } catch (e) {
    console.error('[checkin]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/checkin/checkout/:reservation_id ─────────────────────
router.post('/checkout/:reservation_id', atLeast('receptionist'), async (req, res) => {
  try {
    const r = await db('reservations').where({ id: req.params.reservation_id }).first();
    if (!r) return res.status(404).json({ error: 'Reservation not found' });
    if (r.status !== 'checked_in')
      return res.status(400).json({ error: 'Guest is not currently checked in' });

    const room = await db('rooms').where({ id: r.room_id }).first();

    // ── Create invoice (fixed service) ────────────────────────────
    const invoice = await createInvoice({
      reservation: { ...r, actual_check_out: new Date() },
      room,
      tenantId:   req.tenantId,
      createdBy:  req.user.id,
      lineItems:  [],
    });

    // ── Update reservation ─────────────────────────────────────────
    await db('reservations').where({ id: r.id }).update({
      status:           'checked_out',
      actual_check_out: new Date(),
      checked_out_by:   req.user.id,
      updated_at:       new Date(),
    });

    // ── Lock room for housekeeping ─────────────────────────────────
    await db('rooms').where({ id: r.room_id }).update({
      status:              'maintenance',
      housekeeping_status: 'dirty',
      updated_at:           new Date(),
    });

    // ── Create HK task with default checklist ──────────────────────
    const defaultChecklist = [
      { item: 'Change bed linen and pillowcases', done: false },
      { item: 'Clean and sanitise bathroom',      done: false },
      { item: 'Vacuum / mop floor',               done: false },
      { item: 'Replenish toiletries and amenities', done: false },
      { item: 'Check and restock minibar',         done: false },
      { item: 'Check for lost & found items',      done: false },
      { item: 'Inspect for damage or maintenance', done: false },
      { item: 'Wipe down surfaces and mirrors',    done: false },
    ];

    const [hkTask] = await db('housekeeping_tasks').insert({
      tenant_id:      req.tenantId || null,
      room_id:        r.room_id,
      reservation_id: r.id,
      created_by:     req.user.id,
      status:         'pending',
      priority:       'normal',
      notes:          `Auto-created on checkout of ${r.first_name} ${r.last_name} (${invoice.inv_number})`,
      checklist:      JSON.stringify(defaultChecklist),
    }).returning('*');

    res.json({
      success: true,
      invoice,
      housekeeping_task: hkTask,
    });
  } catch (e) {
    console.error('[checkout]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
