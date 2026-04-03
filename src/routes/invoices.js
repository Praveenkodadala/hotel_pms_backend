import express from 'express';
import db from '../db.js';
import auth from '../middleware/auth.js';
import { tenantScope, atLeast } from '../middleware/rbac.js'
import { getInvoiceById, generateHtml } from '../services/invoiceService.js';

const router = express.Router();
router.use(auth, tenantScope);

// GET /api/invoices
router.get('/', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    let q = db('invoices as i')
      .leftJoin('rooms as r', 'i.room_id', 'r.id')
      .select('i.*', 'r.number as room_number', 'r.type as room_type')
      .orderBy('i.created_at', 'desc');
    if (req.tenantId) q = q.where('i.tenant_id', req.tenantId);
    if (status) q = q.where('i.status', status);
    if (from) q = q.where('i.created_at', '>=', from);
    if (to) q = q.where('i.created_at', '<=', to + 'T23:59:59');
    res.json(await q);
  } catch (e) {
    console.error('[GET /invoices]', e.message);
    res.status(500).json({ error: 'Failed to fetch invoices', detail: e.message });
  }
});

// GET /api/invoices/:id
router.get('/:id', async (req, res) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (req.tenantId && inv.tenant_id && inv.tenant_id !== req.tenantId)
      return res.status(403).json({ error: 'Access denied' });
    res.json(inv);
  } catch (e) {
    if (e.message === 'Invoice not found') return res.status(404).json({ error: e.message });
    res.status(500).json({ error: 'Failed to fetch invoice', detail: e.message });
  }
});

// GET /api/invoices/:id/html
router.get('/:id/html', async (req, res) => {
  try {
    const inv = await getInvoiceById(req.params.id);
    if (req.tenantId && inv.tenant_id && inv.tenant_id !== req.tenantId)
      return res.status(403).json({ error: 'Access denied' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(generateHtml(inv));
  } catch (e) {
    console.error('[GET /invoices/:id/html]', e.message);
    res.status(500).json({ error: 'Failed to generate invoice', detail: e.message });
  }
});

// PATCH /api/invoices/:id/pay
router.patch('/:id/pay', atLeast('receptionist'), async (req, res) => {
  const { payment_method, payment_reference, notes } = req.body;
  if (!payment_method) return res.status(400).json({ error: 'payment_method is required' });
  try {
    const [inv] = await db('invoices').where({ id: req.params.id })
      .update({ status: 'paid', payment_method, payment_reference: payment_reference || null,
        notes: notes || null, paid_at: new Date(), updated_at: new Date() }).returning('*');
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update invoice', detail: e.message });
  }
});

// POST /api/invoices/:id/line-items
router.post('/:id/line-items', atLeast('receptionist'), async (req, res) => {
  const { description, qty, unit_price } = req.body;
  if (!description || !unit_price) return res.status(400).json({ error: 'description and unit_price required' });
  try {
    const inv = await db('invoices').where({ id: req.params.id }).first();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'paid') return res.status(400).json({ error: 'Cannot modify a paid invoice' });
    const items = typeof inv.line_items === 'string' ? JSON.parse(inv.line_items) : (inv.line_items || []);
    const amount = Number(qty || 1) * Number(unit_price);
    items.push({ description, qty: qty || 1, unit_price: Number(unit_price), amount });
    const extrasTotal = items.reduce((s, i) => s + Number(i.amount), 0);
    const subtotal = Number(inv.room_charges) + extrasTotal;
    const taxAmount = Math.round(subtotal * (Number(inv.tax_rate) / 100));
    const [updated] = await db('invoices').where({ id: req.params.id })
      .update({ line_items: JSON.stringify(items), extras_total: extrasTotal,
        tax_amount: taxAmount, grand_total: subtotal + taxAmount, updated_at: new Date() }).returning('*');
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add line item', detail: e.message });
  }
});

// PATCH /api/invoices/:id/cancel
router.patch('/:id/cancel', atLeast('manager'), async (req, res) => {
  try {
    const [inv] = await db('invoices').where({ id: req.params.id })
      .update({ status: 'cancelled', updated_at: new Date() }).returning('*');
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  } catch (e) {
    res.status(500).json({ error: 'Failed to cancel invoice', detail: e.message });
  }
});

export default router;
