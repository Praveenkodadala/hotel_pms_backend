import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import db from '../db.js';
import auth from '../middleware/auth.js';
import cfg from '../config/index.js';

const router = express.Router();

// ── LOGIN ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await db('users').where({ email }).first();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.status === 'disabled') {
      return res.status(403).json({
        error: 'Account is disabled. Contact your administrator.'
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.tenant_id) {
      const tenant = await db('tenants')
        .where({ id: user.tenant_id })
        .select('status', 'subscription_active')
        .first();

      if (tenant && tenant.status !== 'active') {
        return res.status(403).json({
          error: `Hotel account is ${tenant.status}. Contact support.`
        });
      }

      if (tenant && !tenant.subscription_active) {
        return res.status(403).json({
          error: 'Hotel subscription expired. Please renew.'
        });
      }
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id || null,
      name: user.name
    };

    const token = jwt.sign(payload, cfg.jwt.secret, {
      expiresIn: cfg.jwt.expiresIn
    });

    await db('users')
      .where({ id: user.id })
      .update({ last_login_at: new Date() });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id || null
      }
    });

  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Login failed', detail: e.message });
  }
});

// ── ME ──────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await db('users as u')
      .leftJoin('tenants as t', 'u.tenant_id', 't.id')
      .select(
        'u.id','u.name','u.email','u.role','u.status','u.tenant_id','u.last_login_at',
        't.name as tenant_name','t.status as tenant_status','t.logo_url','t.primary_color'
      )
      .where('u.id', req.user.id)
      .first();

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CHANGE PASSWORD ─────────────────────────────────────────────
router.post('/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both passwords required' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 chars' });
  }

  try {
    const user = await db('users').where({ id: req.user.id }).first();

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);

    await db('users')
      .where({ id: req.user.id })
      .update({
        password_hash: hash,
        updated_at: new Date()
      });

    res.json({ success: true });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ IMPORTANT
export default router;