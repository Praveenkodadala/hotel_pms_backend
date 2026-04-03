import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast, tenantOnly } from '../middleware/rbac.js';

const router = express.Router();
router.use(auth, tenantOnly, tenantScope);

// GET /api/admin/users — list users in this hotel
router.get('/users', atLeast('manager'), async (req, res) => {
  try {
    const users = await db('users')
      .where({ tenant_id: req.tenantId })
      .whereNot({ role: 'super_admin' })
      .select('id', 'name', 'email', 'role', 'status', 'phone', 'last_login_at', 'created_at')
      .orderBy('created_at');
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/users — create staff in this hotel
router.post('/users', atLeast('hotel_admin'), async (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });

  // hotel_admin cannot create super_admin
  const allowedRoles = ['hotel_admin', 'manager', 'receptionist', 'housekeeping'];
  if (!allowedRoles.includes(role)) return res.status(403).json({ error: `Cannot create role: ${role}` });

  try {
    const hash = await bcrypt.hash(password, 10);
    const [user] = await db('users').insert({
      tenant_id: req.tenantId, name, email, phone: phone || null,
      password_hash: hash, role, status: 'active', created_by: req.user.id,
    }).returning('id', 'name', 'email', 'role', 'status', 'phone');
    res.status(201).json(user);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/users/:id — update user in this hotel
router.put('/users/:id', atLeast('hotel_admin'), async (req, res) => {
  try {
    // Ensure target user belongs to same tenant
    const existing = await db('users').where({ id: req.params.id, tenant_id: req.tenantId }).first();
    if (!existing) return res.status(404).json({ error: 'User not found in your hotel' });

    const { name, phone, role, status } = req.body;
    const allowedRoles = ['hotel_admin', 'manager', 'receptionist', 'housekeeping'];
    if (role && !allowedRoles.includes(role)) return res.status(403).json({ error: `Cannot assign role: ${role}` });

    const [user] = await db('users').where({ id: req.params.id })
      .update({ name, phone, role, status, updated_at: new Date() })
      .returning('id', 'name', 'email', 'role', 'status', 'phone');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/admin/users/:id/reset-password
router.patch('/users/:id/reset-password', atLeast('hotel_admin'), async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'new_password must be at least 8 chars' });
  try {
    const existing = await db('users').where({ id: req.params.id, tenant_id: req.tenantId }).first();
    if (!existing) return res.status(404).json({ error: 'User not found in your hotel' });
    const hash = await bcrypt.hash(new_password, 10);
    await db('users').where({ id: req.params.id }).update({ password_hash: hash, updated_at: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/users/:id — soft delete (disable)
router.delete('/users/:id', atLeast('hotel_admin'), async (req, res) => {
  try {
    const existing = await db('users').where({ id: req.params.id, tenant_id: req.tenantId }).first();
    if (!existing) return res.status(404).json({ error: 'User not found' });
    await db('users').where({ id: req.params.id }).update({ status: 'disabled', updated_at: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/hotel — get this hotel's profile
router.get('/hotel', async (req, res) => {
  try {
    const tenant = await db('tenants as t')
      .leftJoin('subscription_plans as p', 't.plan_id', 'p.id')
      .select('t.*', 'p.name as plan_name', 'p.max_rooms', 'p.max_users', 'p.features')
      .where('t.id', req.tenantId).first();
    if (!tenant) return res.status(404).json({ error: 'Hotel not found' });
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/hotel — update hotel profile (non-financial fields)
router.put('/hotel', atLeast('hotel_admin'), async (req, res) => {
  const { name, phone, website, address, city, state, pincode, gstin, logo_url, primary_color } = req.body;
  try {
    const [tenant] = await db('tenants').where({ id: req.tenantId })
      .update({ name, phone, website, address, city, state, pincode, gstin, logo_url, primary_color, updated_at: new Date() })
      .returning('*');
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
