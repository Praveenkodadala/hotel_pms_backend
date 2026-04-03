/**
 * Invoice Service — v2
 *
 * Fixes:
 *  1. invoice_sequences uses seq_key TEXT (not UUID), 'global' fallback
 *  2. getInvoiceById uses LEFT JOIN (won't crash if room deleted)
 *  3. Full printable HTML template with GST, line items, tenant branding
 */
import db from '../db.js';
import cfg from '../config/index.js';

/**
 * Generate next invoice number.
 * Format: INV-YYYYMM-NNNNN  e.g. INV-202604-00042
 * seq_key is the tenant UUID, or 'global' for non-tenant invoices.
 */
async function nextInvNumber(tenantId, trx) {
  const q = trx || db;
  const seqKey = tenantId || 'global';
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');

  await q.raw(`
    INSERT INTO invoice_sequences (seq_key, last_seq)
    VALUES (?, 1)
    ON CONFLICT (seq_key) DO UPDATE SET last_seq = invoice_sequences.last_seq + 1
  `, [seqKey]);

  const row = await q('invoice_sequences').where({ seq_key: seqKey }).select('last_seq').first();
  const seq = String(row.last_seq).padStart(5, '0');
  return `INV-${ym}-${seq}`;
}

/**
 * Create invoice from checkout data.
 */
async function createInvoice({ reservation, room, tenantId, createdBy, lineItems = [] }, trx) {
  const q = trx || db;

  const checkIn  = new Date(reservation.actual_check_in  || reservation.check_in);
  const checkOut = new Date(reservation.actual_check_out || new Date());
  const nights = Math.max(1, Math.ceil((checkOut - checkIn) / 86400000));
  const roomCharges  = Number(reservation.rate_per_night) * nights;
  const extrasTotal  = lineItems.reduce((s, i) => s + Number(i.amount || 0), 0);
  const subtotal     = roomCharges + extrasTotal;
  const taxRate      = cfg.gst.roomRate;
  const taxAmount    = Math.round(subtotal * (taxRate / 100));
  const grandTotal   = subtotal + taxAmount;

  const invNumber = await nextInvNumber(tenantId, q);

  const [invoice] = await q('invoices').insert({
    inv_number:    invNumber,
    tenant_id:     tenantId || null,
    reservation_id: reservation.id,
    room_id:       reservation.room_id,
    guest_name:    `${reservation.first_name} ${reservation.last_name}`,
    guest_email:   reservation.email  || '',
    guest_phone:   reservation.phone  || '',
    check_in:      checkIn,
    check_out:     checkOut,
    nights,
    rate_per_night: reservation.rate_per_night,
    room_charges:  roomCharges,
    line_items:    JSON.stringify(lineItems),
    extras_total:  extrasTotal,
    tax_rate:      taxRate,
    tax_amount:    taxAmount,
    grand_total:   grandTotal,
    status:        'unpaid',
    invoice_type:  'standard',
    created_by:    createdBy,
  }).returning('*');

  return { ...invoice, room_number: room.number, room_type: room.type };
}

/**
 * Fetch invoice with all related info.
 * Uses LEFT JOINs — safe even if room/tenant is missing.
 */
async function getInvoiceById(id) {
  const inv = await db('invoices as i')
    .leftJoin('rooms as r',   'i.room_id',   'r.id')
    .leftJoin('tenants as t', 'i.tenant_id', 't.id')
    .select(
      'i.*',
      'r.number as room_number',
      'r.type   as room_type',
      't.name    as tenant_name',
      't.address as tenant_address',
      't.phone   as tenant_phone',
      't.email   as tenant_email',
      't.gstin   as tenant_gstin',
      't.logo_url as tenant_logo',
    )
    .where('i.id', id)
    .first();

  if (!inv) throw new Error('Invoice not found');
  return inv;
}

/**
 * Generate printable standalone HTML invoice.
 * Works in browser print dialog and as Puppeteer PDF source.
 */
function generateHtml(inv) {
  const fmt = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  };
  const fmtCur = (n) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  const hotelName    = inv.tenant_name    || cfg.hotel.name;
  const hotelAddress = inv.tenant_address || cfg.hotel.address;
  const hotelPhone   = inv.tenant_phone   || cfg.hotel.phone;
  const hotelEmail   = inv.tenant_email   || cfg.hotel.email;
  const hotelGstin   = inv.tenant_gstin   || cfg.hotel.gstin;
  const logoUrl      = inv.tenant_logo    || cfg.hotel.logoUrl;

  let lineItemRows = '';
  try {
    const items = typeof inv.line_items === 'string'
      ? JSON.parse(inv.line_items)
      : (inv.line_items || []);
    lineItemRows = items.map((item) => `
      <tr>
        <td class="desc">${item.description || 'Extra charge'}</td>
        <td class="center">${item.qty || 1}</td>
        <td class="right">${fmtCur(item.unit_price || item.amount)}</td>
        <td class="right">${fmtCur(item.amount)}</td>
      </tr>`).join('');
  } catch (_) { /* ignore parse errors */ }

  const statusColor = inv.status === 'paid' ? '#059669' : '#D97706';
  const statusLabel = (inv.status || 'UNPAID').toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Invoice ${inv.inv_number}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; }
  .page { max-width: 780px; margin: 0 auto; padding: 44px 40px; }

  /* ── Header ── */
  .inv-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .hotel-logo { height: 48px; display: block; margin-bottom: 8px; }
  .hotel-name { font-size: 21px; font-weight: 700; color: #185FA5; margin-bottom: 4px; }
  .hotel-meta { font-size: 12px; color: #666; line-height: 1.7; }
  .inv-title-block { text-align: right; }
  .inv-title { font-size: 30px; font-weight: 700; color: #185FA5; letter-spacing: 2px; }
  .inv-number { font-size: 14px; color: #444; margin-top: 2px; font-weight: 600; }
  .inv-date   { font-size: 12px; color: #666; margin-top: 2px; }
  .status-pill { display: inline-block; padding: 4px 14px; border-radius: 20px;
    font-size: 12px; font-weight: 600; color: #fff; margin-top: 8px;
    background: ${statusColor}; }

  /* ── Divider ── */
  .rule { border: none; border-top: 2px solid #185FA5; margin: 20px 0; }
  .rule-light { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }

  /* ── Bill to / Stay info ── */
  .two-col { display: flex; gap: 48px; margin-bottom: 28px; }
  .two-col > div { flex: 1; }
  .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1px; color: #185FA5; margin-bottom: 8px; }
  .guest-name  { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .meta-line   { font-size: 12px; color: #555; line-height: 1.8; }
  .stay-row    { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
  .stay-row span:first-child { color: #777; }

  /* ── Charges table ── */
  table.charges { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.charges thead tr { background: #185FA5; color: #fff; }
  table.charges th { padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; }
  table.charges td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 12px; vertical-align: top; }
  td.desc   { font-weight: 500; }
  td.center { text-align: center; }
  td.right  { text-align: right; }
  th.center { text-align: center; }
  th.right  { text-align: right; }
  table.charges tbody tr:last-child td { border-bottom: none; }

  /* ── Totals ── */
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 24px; }
  table.totals { width: 290px; font-size: 13px; border-collapse: collapse; }
  table.totals td { padding: 6px 12px; }
  table.totals td:last-child { text-align: right; font-weight: 500; }
  table.totals tr.grand td { font-size: 16px; font-weight: 700; color: #185FA5;
    border-top: 2px solid #185FA5; padding-top: 10px; }

  /* ── Payment stamp ── */
  .payment-stamp { margin: 16px 0; padding: 12px 16px;
    background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
    font-size: 13px; color: #065f46; font-weight: 500; }

  /* ── Footer ── */
  .inv-footer { margin-top: 40px; padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    display: flex; justify-content: space-between; align-items: flex-end; }
  .footer-note { font-size: 11px; color: #888; line-height: 1.8; }

  /* ── Print button (hidden in print) ── */
  .print-btn { position: fixed; bottom: 24px; right: 24px;
    padding: 11px 22px; background: #185FA5; color: #fff; border: none;
    border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;
    box-shadow: 0 2px 12px rgba(0,0,0,.2); }
  .print-btn:hover { background: #0C447C; }

  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 20px; }
    .print-btn { display: none; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="inv-header">
    <div>
      ${logoUrl ? `<img src="${logoUrl}" alt="${hotelName}" class="hotel-logo">` : ''}
      <div class="hotel-name">${hotelName}</div>
      <div class="hotel-meta">
        ${hotelAddress ? hotelAddress + '<br>' : ''}
        ${hotelPhone   ? 'Ph: ' + hotelPhone + (hotelEmail ? '&nbsp;&nbsp;|&nbsp;&nbsp;' : '') : ''}
        ${hotelEmail   ? hotelEmail + '<br>' : ''}
        ${hotelGstin   ? 'GSTIN: ' + hotelGstin : ''}
      </div>
    </div>
    <div class="inv-title-block">
      <div class="inv-title">INVOICE</div>
      <div class="inv-number">${inv.inv_number}</div>
      <div class="inv-date">Date: ${fmt(inv.created_at)}</div>
      <div><span class="status-pill">${statusLabel}</span></div>
    </div>
  </div>

  <hr class="rule">

  <!-- Bill to + Stay -->
  <div class="two-col">
    <div>
      <div class="section-label">Bill to</div>
      <div class="guest-name">${inv.guest_name}</div>
      ${inv.guest_email ? `<div class="meta-line">${inv.guest_email}</div>` : ''}
      ${inv.guest_phone ? `<div class="meta-line">${inv.guest_phone}</div>` : ''}
    </div>
    <div>
      <div class="section-label">Stay details</div>
      <div class="stay-row">
        <span>Room</span>
        <span><strong>${inv.room_number || '—'}</strong> &nbsp;(${inv.room_type || '—'})</span>
      </div>
      <div class="stay-row"><span>Check-in</span><span>${fmt(inv.check_in)}</span></div>
      <div class="stay-row"><span>Check-out</span><span>${fmt(inv.check_out)}</span></div>
      <div class="stay-row">
        <span>Duration</span>
        <span>${inv.nights} night${inv.nights !== 1 ? 's' : ''}</span>
      </div>
      ${inv.reservation_id
        ? `<div class="stay-row"><span>Res #</span>
           <span style="font-size:11px;color:#999">${String(inv.reservation_id).slice(-8).toUpperCase()}</span></div>`
        : ''}
    </div>
  </div>

  <!-- Charges table -->
  <table class="charges">
    <thead>
      <tr>
        <th style="width:46%">Description</th>
        <th class="center" style="width:10%">Nights</th>
        <th class="right"  style="width:22%">Rate / Night</th>
        <th class="right"  style="width:22%">Amount</th>
      </tr>
    </thead>
    <tbody>
      <!-- Room charge row -->
      <tr>
        <td class="desc">
          Room ${inv.room_number || ''} — ${inv.room_type || 'Accommodation'}<br>
          <span style="font-size:11px;color:#999">${fmt(inv.check_in)} → ${fmt(inv.check_out)}</span>
        </td>
        <td class="center">${inv.nights}</td>
        <td class="right">${fmtCur(inv.rate_per_night)}</td>
        <td class="right">${fmtCur(inv.room_charges)}</td>
      </tr>
      <!-- Extra line items -->
      ${lineItemRows}
    </tbody>
  </table>

  <!-- Totals block -->
  <div class="totals-wrap">
    <table class="totals">
      <tbody>
        <tr>
          <td style="color:#666">Room charges</td>
          <td>${fmtCur(inv.room_charges)}</td>
        </tr>
        ${Number(inv.extras_total) > 0 ? `
        <tr>
          <td style="color:#666">Extras &amp; services</td>
          <td>${fmtCur(inv.extras_total)}</td>
        </tr>` : ''}
        <tr>
          <td style="color:#666">GST (${inv.tax_rate}%)</td>
          <td>${fmtCur(inv.tax_amount)}</td>
        </tr>
      </tbody>
      <tbody>
        <tr class="grand">
          <td>Total</td>
          <td>${fmtCur(inv.grand_total)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Payment confirmation -->
  ${inv.status === 'paid' ? `
  <div class="payment-stamp">
    ✓ Paid via ${inv.payment_method || '—'}
    ${inv.paid_at     ? ' on ' + fmt(inv.paid_at) : ''}
    ${inv.payment_reference ? ' · Ref: ' + inv.payment_reference : ''}
  </div>` : ''}

  ${inv.notes ? `<p style="font-size:12px;color:#555;margin-bottom:16px"><strong>Notes:</strong> ${inv.notes}</p>` : ''}

  <!-- Footer -->
  <div class="inv-footer">
    <div class="footer-note">
      Thank you for your stay with us.<br>
      Queries: ${hotelEmail || hotelPhone || '—'}
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#bbb">Generated by Hotel PMS</div>
      <div style="font-size:11px;color:#bbb">${new Date().toLocaleString('en-IN')}</div>
    </div>
  </div>

</div><!-- /page -->

<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
</body>
</html>`;
}

export {
  createInvoice,
  getInvoiceById,
  generateHtml,
  nextInvNumber
};
