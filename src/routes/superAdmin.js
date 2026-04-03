import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { superAdminOnly } from '../middleware/rbac.js';

const router = express.Router();
router.use(auth, superAdminOnly);

// ═══════════════════════════════════════════════
// SUBSCRIPTION PLANS
// ═══════════════════════════════════════════════

// GET /api/super-admin/plans
router.get('/plans', async (req, res) => {
  try { res.json(await db('subscription_plans').orderBy('price_monthly')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/super-admin/plans
router.post('/plans', async (req, res) => {
  const { name, description, price_monthly, max_rooms, max_users, features } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const [plan] = await db('subscription_plans').insert({
      name, description, price_monthly: price_monthly || 0,
      max_rooms: max_rooms || 50, max_users: max_users || 10,
      features: features ? JSON.stringify(features) : '{}',
    }).returning('*');
    res.status(201).json(plan);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/super-admin/plans/:id
router.put('/plans/:id', async (req, res) => {
  try {
    const [plan] = await db('subscription_plans').where({ id: req.params.id })
      .update({ ...req.body, updated_at: new Date() }).returning('*');
    res.json(plan);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
// TENANTS (HOTELS / CLIENTS)
// ═══════════════════════════════════════════════

// GET /api/super-admin/tenants
router.get('/tenants', async (req, res) => {
  try {
    const { status, search } = req.query;
    let q = db('tenants as t')
      .leftJoin('subscription_plans as p', 't.plan_id', 'p.id')
      .select('t.*', 'p.name as plan_name', 'p.price_monthly')
      .orderBy('t.created_at', 'desc');
    if (status) q = q.where('t.status', status);
    if (search) q = q.where(function () {
      this.whereILike('t.name', `%${search}%`).orWhereILike('t.email', `%${search}%`);
    });
    res.json(await q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/super-admin/tenants/:id
router.get('/tenants/:id', async (req, res) => {
  try {
    const tenant = await db('tenants as t')
      .leftJoin('subscription_plans as p', 't.plan_id', 'p.id')
      .select('t.*', 'p.name as plan_name')
      .where('t.id', req.params.id).first();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    // Include user count
    const [{ count }] = await db('users').where({ tenant_id: req.params.id }).count('id as count');
    res.json({ ...tenant, user_count: parseInt(count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/super-admin/tenants — create hotel + its admin user
router.post('/tenants', async (req, res) => {
  const {
    name, email, phone, website, address, city, state, country, pincode,
    gstin, pan, plan_id, subscription_start, subscription_end,
    // First admin user for this hotel
    admin_name, admin_email, admin_password,
  } = req.body;

  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  if (!admin_email || !admin_password) return res.status(400).json({ error: 'admin_email and admin_password required for first admin' });

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

  const trx = await db.transaction();
  try {
    // Create tenant
    const [tenant] = await trx('tenants').insert({
      name, slug, email, phone, website, address, city, state,
      country: country || 'India', pincode, gstin, pan,
      plan_id: plan_id || null,
      subscription_start: subscription_start || new Date(),
      subscription_end: subscription_end || null,
      subscription_active: true, status: 'active',
    }).returning('*');

    // Create hotel admin user
    const hash = await bcrypt.hash(admin_password, 10);
    const [adminUser] = await trx('users').insert({
      tenant_id: tenant.id,
      name: admin_name || 'Admin',
      email: admin_email,
      password_hash: hash,
      role: 'hotel_admin',
      status: 'active',
      created_by: req.user.id,
    }).returning('id', 'name', 'email', 'role');

    // Audit log
    await trx('tenant_audit_log').insert({
      tenant_id: tenant.id, user_id: req.user.id,
      action: 'TENANT_CREATED', payload: JSON.stringify({ name, admin_email }),
    });

    await trx.commit();
    res.status(201).json({ tenant, admin_user: adminUser });
  } catch (e) {
    await trx.rollback();
    if (e.code === '23505') return res.status(409).json({ error: 'Email or slug already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/super-admin/tenants/:id
router.put('/tenants/:id', async (req, res) => {
  try {
    const [tenant] = await db('tenants').where({ id: req.params.id })
      .update({ ...req.body, updated_at: new Date() }).returning('*');
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    await db('tenant_audit_log').insert({
      tenant_id: req.params.id, user_id: req.user.id,
      action: 'TENANT_UPDATED', payload: JSON.stringify(req.body),
    });
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/super-admin/tenants/:id/disable
router.patch('/tenants/:id/disable', async (req, res) => {
  const { reason } = req.body;
  try {
    const [tenant] = await db('tenants').where({ id: req.params.id })
      .update({ status: 'disabled', disable_reason: reason || 'Disabled by super admin', updated_at: new Date() })
      .returning('*');
    await db('tenant_audit_log').insert({
      tenant_id: req.params.id, user_id: req.user.id,
      action: 'TENANT_DISABLED', payload: JSON.stringify({ reason }),
    });
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/super-admin/tenants/:id/enable
router.patch('/tenants/:id/enable', async (req, res) => {
  try {
    const [tenant] = await db('tenants').where({ id: req.params.id })
      .update({ status: 'active', disable_reason: null, updated_at: new Date() }).returning('*');
    await db('tenant_audit_log').insert({
      tenant_id: req.params.id, user_id: req.user.id,
      action: 'TENANT_ENABLED', payload: '{}',
    });
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/super-admin/tenants/:id/subscription
router.patch('/tenants/:id/subscription', async (req, res) => {
  const { plan_id, subscription_end, subscription_active } = req.body;
  try {
    const [tenant] = await db('tenants').where({ id: req.params.id })
      .update({ plan_id, subscription_end, subscription_active, updated_at: new Date() }).returning('*');
    await db('tenant_audit_log').insert({
      tenant_id: req.params.id, user_id: req.user.id,
      action: 'SUBSCRIPTION_UPDATED', payload: JSON.stringify({ plan_id, subscription_end, subscription_active }),
    });
    res.json(tenant);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
// USER MANAGEMENT (GLOBAL)
// ═══════════════════════════════════════════════

// GET /api/super-admin/users
router.get('/users', async (req, res) => {
  try {
    const { tenant_id, role, status, search } = req.query;
    let q = db('users as u')
      .leftJoin('tenants as t', 'u.tenant_id', 't.id')
      .select('u.id', 'u.name', 'u.email', 'u.role', 'u.status', 'u.tenant_id',
        'u.created_at', 'u.last_login_at', 't.name as tenant_name')
      .orderBy('u.created_at', 'desc');
    if (tenant_id) q = q.where('u.tenant_id', tenant_id);
    if (role) q = q.where('u.role', role);
    if (status) q = q.where('u.status', status);
    if (search) q = q.where(function () {
      this.whereILike('u.name', `%${search}%`).orWhereILike('u.email', `%${search}%`);
    });
    res.json(await q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/super-admin/users — create user in any tenant
router.post('/users', async (req, res) => {
  const { tenant_id, name, email, password, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'name, email, password, role required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [user] = await db('users').insert({
      tenant_id: tenant_id || null, name, email,
      password_hash: hash, role, status: 'active', created_by: req.user.id,
    }).returning('id', 'name', 'email', 'role', 'status', 'tenant_id');
    res.status(201).json(user);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/super-admin/users/:id/disable
router.patch('/users/:id/disable', async (req, res) => {
  try {
    const [user] = await db('users').where({ id: req.params.id })
      .update({ status: 'disabled', updated_at: new Date() }).returning('id', 'name', 'email', 'status');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/super-admin/users/:id/enable
router.patch('/users/:id/enable', async (req, res) => {
  try {
    const [user] = await db('users').where({ id: req.params.id })
      .update({ status: 'active', updated_at: new Date() }).returning('id', 'name', 'email', 'status');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/super-admin/users/:id/role
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  const allowed = ['super_admin', 'hotel_admin', 'manager', 'receptionist', 'housekeeping'];
  if (!allowed.includes(role)) return res.status(400).json({ error: `role must be one of: ${allowed.join(', ')}` });
  try {
    const [user] = await db('users').where({ id: req.params.id })
      .update({ role, updated_at: new Date() }).returning('id', 'name', 'email', 'role');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════

// GET /api/super-admin/audit-log
router.get('/audit-log', async (req, res) => {
  try {
    const logs = await db('tenant_audit_log as l')
      .leftJoin('tenants as t', 'l.tenant_id', 't.id')
      .leftJoin('users as u', 'l.user_id', 'u.id')
      .select('l.*', 't.name as tenant_name', 'u.name as user_name', 'u.email as user_email')
      .orderBy('l.created_at', 'desc')
      .limit(200);
    res.json(logs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
// SUPER ADMIN DASHBOARD STATS
// ═══════════════════════════════════════════════

// GET /api/super-admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [tenants, users, subs] = await Promise.all([
      db('tenants').select(db.raw('status, count(*) as count')).groupBy('status'),
      db('users').select(db.raw('role, count(*) as count')).groupBy('role'),
      db('tenants').select(db.raw(
        "count(*) filter (where subscription_active = true) as active_subs, " +
        "count(*) filter (where subscription_active = false) as expired_subs, " +
        "count(*) filter (where subscription_end < now()) as due_subs"
      )).first(),
    ]);
    res.json({
      tenants: tenants.reduce((a, r) => { a[r.status] = parseInt(r.count); return a; }, {}),
      users: users.reduce((a, r) => { a[r.role] = parseInt(r.count); return a; }, {}),
      subscriptions: subs,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
