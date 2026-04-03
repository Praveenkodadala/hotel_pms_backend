import db from '../db.js';

const ROLE_WEIGHTS = {
  super_admin: 100,
  hotel_admin: 80,
  manager: 60,
  receptionist: 40,
  housekeeping: 20,
};

// ── roles (exact match) ─────────────────────────────────────────
export const roles = (...allowed) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

  if (allowed.includes(req.user.role)) return next();

  return res.status(403).json({
    error: `Access denied. Required role: ${allowed.join(' or ')}. Your role: ${req.user.role}`,
  });
};

// ── atLeast (role hierarchy) ────────────────────────────────────
export const atLeast = (minRole) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });

  const userWeight = ROLE_WEIGHTS[req.user.role] || 0;
  const minWeight = ROLE_WEIGHTS[minRole] || 0;

  if (userWeight >= minWeight) return next();

  return res.status(403).json({ error: `Minimum role required: ${minRole}` });
};

// ── tenantOnly ──────────────────────────────────────────────────
export const tenantOnly = (req, res, next) => {
  if (req.user?.role === 'super_admin') {
    return res.status(403).json({
      error: 'Super admin must use /api/super-admin/* routes',
    });
  }
  next();
};

// ── tenantScope ─────────────────────────────────────────────────
export const tenantScope = async (req, res, next) => {
  try {
    if (req.user?.role === 'super_admin') {
      req.tenantId = req.params.tenantId || req.query.tenant_id || null;
      return next();
    }

    const tenantId = req.user?.tenant_id;

    if (!tenantId) {
      return res.status(403).json({ error: 'No tenant associated with user' });
    }

    if (!req._tenantChecked) {
      const tenant = await db('tenants')
        .where({ id: tenantId })
        .select('status', 'subscription_active', 'subscription_end')
        .first();

      if (!tenant) return res.status(403).json({ error: 'Tenant not found' });

      if (tenant.status !== 'active') {
        return res.status(403).json({
          error: 'Hotel account is disabled. Contact support.',
        });
      }

      if (!tenant.subscription_active) {
        return res.status(403).json({
          error: 'Subscription expired. Please renew.',
        });
      }

      req._tenantChecked = true;
    }

    req.tenantId = tenantId;
    next();

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// ── superAdminOnly ──────────────────────────────────────────────
export const superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access only' });
  }
  next();
};