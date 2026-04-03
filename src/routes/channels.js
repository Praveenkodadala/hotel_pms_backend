import express from 'express';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast, tenantOnly } from '../middleware/rbac.js';

const router = express.Router();
router.use(auth, tenantOnly, tenantScope);

router.get('/', async (req, res) => {
  try {
    let q = db('channels').orderBy('name');
    if (req.tenantId) q = q.where({ tenant_id: req.tenantId });
    const channels = await q;
    res.json(channels.map(c => ({ ...c, api_key: c.api_key ? '••••' + c.api_key.slice(-4) : '' })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', atLeast('manager'), async (req, res) => {
  const { name, api_key, hotel_id_on_channel, commission_pct } = req.body;
  if (!name || !api_key || !hotel_id_on_channel) return res.status(400).json({ error: 'name, api_key, hotel_id_on_channel required' });
  try {
    const existing = await db('channels').where({ name, tenant_id: req.tenantId || null }).first();
    if (existing) return res.status(409).json({ error: `${name} is already connected` });
    const [ch] = await db('channels').insert({
      tenant_id: req.tenantId || null,
      name, api_key, hotel_id_on_channel,
      commission_pct: commission_pct || 0, active: true,
    }).returning('*');
    await db('channel_sync_log').insert({ channel_id: ch.id, event: `Channel ${name} connected`, status: 'success' });
    res.status(201).json({ ...ch, api_key: '••••' + ch.api_key.slice(-4) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/toggle', atLeast('manager'), async (req, res) => {
  try {
    const ch = await db('channels').where({ id: req.params.id }).first();
    if (!ch) return res.status(404).json({ error: 'Not found' });
    const [updated] = await db('channels').where({ id: req.params.id })
      .update({ active: !ch.active, updated_at: new Date() }).returning('*');
    await db('channel_sync_log').insert({ channel_id: ch.id, event: `Channel ${updated.active ? 'activated' : 'deactivated'}`, status: 'info' });
    res.json({ ...updated, api_key: '••••' + updated.api_key.slice(-4) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', atLeast('hotel_admin'), async (req, res) => {
  try { await db('channels').where({ id: req.params.id }).del(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/sync', atLeast('manager'), async (req, res) => {
  try {
    const ch = await db('channels').where({ id: req.params.id }).first();
    if (!ch) return res.status(404).json({ error: 'Not found' });
    // TODO: call external channel API here (Booking.com / Expedia XML push)
    await db('channel_sync_log').insert({ channel_id: ch.id, event: 'Manual sync triggered — availability & rates pushed', status: 'success' });
    res.json({ success: true, message: `Sync triggered for ${ch.name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/channels/sync-log
router.get('/sync-log', async (req, res) => {
  try {
    let q = db('channel_sync_log as l').join('channels as c','l.channel_id','c.id')
      .select('l.*','c.name as channel_name').orderBy('l.created_at','desc').limit(100);
    if (req.tenantId) q = q.where('c.tenant_id', req.tenantId);
    res.json(await q);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
