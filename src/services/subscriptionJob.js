/**
 * Subscription Expiry Job
 *
 * Runs daily to:
 *  1. Mark expired subscriptions as inactive (subscription_active = false)
 *  2. Log the action to tenant_audit_log
 *
 * Does NOT delete data or disable hotel accounts — only sets the flag.
 * The tenantScope middleware then blocks login with a clear message.
 *
 * Usage: called from server.js on startup, then every 24h
 */

import db from '../db.js';

async function checkSubscriptionExpiry() {
  try {
    const now = new Date().toISOString();

    const expired = await db('tenants')
      .where('subscription_active', true)
      .where('subscription_end', '<', now)
      .whereNotNull('subscription_end')
      .select('id', 'name', 'subscription_end');

    if (expired.length === 0) return;

    console.log(`[SubscriptionJob] Found ${expired.length} expired subscription(s)`);

    for (const tenant of expired) {
      await db('tenants').where({ id: tenant.id }).update({
        subscription_active: false,
        updated_at: new Date(),
      });

      await db('tenant_audit_log').insert({
        tenant_id: tenant.id,
        user_id: null,
        action: 'SUBSCRIPTION_EXPIRED',
        payload: JSON.stringify({ subscription_end: tenant.subscription_end }),
      });

      console.log(
        `[SubscriptionJob] Marked ${tenant.name} (${tenant.id}) as subscription_active=false`
      );
    }
  } catch (e) {
    console.error('[SubscriptionJob] Error:', e.message);
  }
}

function startSubscriptionJob() {
  checkSubscriptionExpiry();

  const INTERVAL_MS = 24 * 60 * 60 * 1000;
  setInterval(checkSubscriptionExpiry, INTERVAL_MS);

  console.log('[SubscriptionJob] Scheduled — runs every 24h');
}


export { startSubscriptionJob, checkSubscriptionExpiry };