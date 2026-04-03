const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  // Clear in safe dependency order
  await knex('channel_sync_log').del();
  await knex('channels').del();
  await knex('housekeeping_tasks').del();
  await knex('invoices').del();
  await knex('invoice_sequences').del();
  await knex('reservations').del();
  await knex('rates').del();
  await knex('inventory_closures').del();
  await knex('rooms').del();
  await knex('tenant_audit_log').del();
  // Delete non-super-admin users first (they reference tenants)
  await knex('users').whereNot({ role: 'super_admin' }).del();
  await knex('users').where({ role: 'super_admin' }).del();
  await knex('tenants').del();
  await knex('subscription_plans').del();

  // ── Plans ──────────────────────────────────────────────────────
  const [starterPlan, proPlan, entPlan] = await knex('subscription_plans').insert([
    { name: 'Starter',      description: 'Up to 20 rooms, 3 users',        price_monthly: 1999,  max_rooms: 20,   max_users: 3,    features: JSON.stringify({ channel_manager: false, housekeeping: false, invoicing: true }) },
    { name: 'Professional', description: 'Up to 75 rooms, all features',   price_monthly: 4999,  max_rooms: 75,   max_users: 10,   features: JSON.stringify({ channel_manager: true,  housekeeping: true,  invoicing: true }) },
    { name: 'Enterprise',   description: 'Unlimited rooms & users',         price_monthly: 12999, max_rooms: 9999, max_users: 9999, features: JSON.stringify({ channel_manager: true,  housekeeping: true,  invoicing: true, api_access: true }) },
  ]).returning('*');

  // ── Super Admin (platform level — no tenant) ───────────────────
  const superHash = await bcrypt.hash('SuperAdmin@999', 10);
  const [superAdmin] = await knex('users').insert({
    tenant_id:     null,
    name:          'Super Admin',
    email:         'superadmin@hotelpms.io',
    password_hash: superHash,
    role:          'super_admin',
    status:        'active',
  }).returning('*');

  // ── Tenant 1: Grand Palace Hotel (active, Pro plan) ───────────
  const subEnd = new Date(Date.now() + 365 * 86400000);
  const [tenant1] = await knex('tenants').insert({
    name:               'Grand Palace Hotel',
    slug:               'grand-palace',
    email:              'admin@grandpalace.com',
    phone:              '+91 821 234 5678',
    address:            '123 MG Road, Mysuru, Karnataka 570001',
    city:               'Mysuru',
    state:              'Karnataka',
    country:            'India',
    gstin:              '29AABCU9603R1ZX',
    plan_id:            proPlan.id,
    subscription_start: new Date(),
    subscription_end:   subEnd,
    subscription_active: true,
    status:             'active',
  }).returning('*');

  // ── Tenant 2: Sunrise Inn (active, expired subscription) ───────
  const [tenant2] = await knex('tenants').insert({
    name:               'Sunrise Inn',
    slug:               'sunrise-inn',
    email:              'admin@sunriseinn.com',
    phone:              '+91 80 9876 5432',
    address:            '45 Brigade Road, Bengaluru',
    city:               'Bengaluru',
    state:              'Karnataka',
    country:            'India',
    plan_id:            starterPlan.id,
    subscription_start: new Date(Date.now() - 400 * 86400000),
    subscription_end:   new Date(Date.now() -  30 * 86400000), // expired 30 days ago
    subscription_active: false,
    status:             'active',
  }).returning('*');

  // ── Users for Grand Palace ─────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@1234', 10);
  const staffHash = await bcrypt.hash('Staff@1234', 10);

  const [hotelAdmin, manager, receptionist, hkStaff] = await knex('users').insert([
    { tenant_id: tenant1.id, name: 'Priya Sharma',  email: 'admin@hotel.com',        password_hash: adminHash, role: 'hotel_admin',  status: 'active', phone: '+91 98765 10001', created_by: superAdmin.id },
    { tenant_id: tenant1.id, name: 'Arjun Menon',   email: 'manager@hotel.com',      password_hash: staffHash, role: 'manager',      status: 'active', phone: '+91 98765 10002', created_by: superAdmin.id },
    { tenant_id: tenant1.id, name: 'Ravi Kumar',    email: 'frontdesk@hotel.com',    password_hash: staffHash, role: 'receptionist', status: 'active', phone: '+91 98765 10003', created_by: superAdmin.id },
    { tenant_id: tenant1.id, name: 'Lakshmi Devi',  email: 'housekeeping@hotel.com', password_hash: staffHash, role: 'housekeeping', status: 'active', phone: '+91 98765 10004', created_by: superAdmin.id },
  ]).returning('*');

  // ── Rooms for Grand Palace ─────────────────────────────────────
  const rooms = await knex('rooms').insert([
    { tenant_id: tenant1.id, number: '101', type: 'Standard',       floor: 1, max_occupancy: 2, base_rate: 3500,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '102', type: 'Standard',       floor: 1, max_occupancy: 2, base_rate: 3500,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '103', type: 'Standard',       floor: 1, max_occupancy: 3, base_rate: 3800,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '201', type: 'Deluxe',         floor: 2, max_occupancy: 2, base_rate: 5500,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '202', type: 'Deluxe',         floor: 2, max_occupancy: 2, base_rate: 5500,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '203', type: 'Deluxe',         floor: 2, max_occupancy: 3, base_rate: 6000,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '301', type: 'Junior Suite',   floor: 3, max_occupancy: 3, base_rate: 8000,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '302', type: 'Suite',          floor: 3, max_occupancy: 4, base_rate: 9500,  status: 'available',   housekeeping_status: 'clean' },
    { tenant_id: tenant1.id, number: '401', type: 'Presidential',   floor: 4, max_occupancy: 4, base_rate: 18000, status: 'maintenance', housekeeping_status: 'dirty' },
  ]).returning('*');

  // ── Rates ──────────────────────────────────────────────────────
  await knex('rates').insert([
    { room_type: 'Standard',     season: 'Peak',     price_per_night: 4500,  valid_from: '2025-10-01', valid_to: '2026-01-31' },
    { room_type: 'Standard',     season: 'Off-peak', price_per_night: 3000,  valid_from: '2026-02-01', valid_to: '2026-09-30' },
    { room_type: 'Standard',     season: 'Weekend',  price_per_night: 4000,  valid_from: '2025-10-01', valid_to: '2026-12-31' },
    { room_type: 'Deluxe',       season: 'Peak',     price_per_night: 7000,  valid_from: '2025-10-01', valid_to: '2026-01-31' },
    { room_type: 'Deluxe',       season: 'Off-peak', price_per_night: 5000,  valid_from: '2026-02-01', valid_to: '2026-09-30' },
    { room_type: 'Junior Suite', season: 'Peak',     price_per_night: 10000, valid_from: '2025-10-01', valid_to: '2026-01-31' },
    { room_type: 'Suite',        season: 'Peak',     price_per_night: 12000, valid_from: '2025-10-01', valid_to: '2026-01-31' },
    { room_type: 'Presidential', season: 'Peak',     price_per_night: 22000, valid_from: '2025-10-01', valid_to: '2026-01-31' },
  ]);

  // ── Sample reservations ────────────────────────────────────────
  const today    = new Date().toISOString().split('T')[0];
  const addDays  = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().split('T')[0]; };

  const [res1] = await knex('reservations').insert([
    {
      res_number:     'RES000001',
      room_id:        rooms[3].id, // Room 201 Deluxe
      first_name:     'Meera', last_name: 'Sharma',
      email:          'meera@example.com', phone: '+91 98765 00001',
      check_in:       today, check_out: addDays(today, 3),
      adults: 2, source: 'direct',
      rate_per_night: 5500, total_amount: 16500, status: 'confirmed',
    },
    {
      res_number:     'RES000002',
      room_id:        rooms[7].id, // Room 302 Suite
      first_name:     'Vikram', last_name: 'Nair',
      email:          'vikram@example.com', phone: '+91 98765 00002',
      check_in:       addDays(today, 2), check_out: addDays(today, 5),
      adults: 2, source: 'Booking.com', notes: 'Late checkout requested',
      rate_per_night: 9500, total_amount: 28500, status: 'confirmed',
    },
  ]).returning('*');

  // Mark Room 201 as reserved
  await knex('rooms').where({ id: rooms[3].id }).update({ status: 'reserved' });

  // ── HK task for Presidential Suite (already dirty) ─────────────
  await knex('housekeeping_tasks').insert({
    tenant_id:    tenant1.id,
    room_id:      rooms[8].id, // Room 401 Presidential
    assigned_to:  hkStaff.id,
    created_by:   receptionist.id,
    status:       'assigned',
    priority:     'high',
    notes:        'Presidential suite — deep clean required before VIP guest arrival',
    checklist:    JSON.stringify([
      { item: 'Change premium bed linen', done: false },
      { item: 'Deep clean bathroom + jacuzzi', done: false },
      { item: 'Polish all surfaces', done: false },
      { item: 'Replenish premium amenities', done: false },
      { item: 'Check and restock minibar', done: false },
      { item: 'Vacuum and steam-clean carpet', done: false },
      { item: 'Inspect for any damage', done: false },
    ]),
  });

  // ── Channels ───────────────────────────────────────────────────
  const [bdc, mmt] = await knex('channels').insert([
    { tenant_id: tenant1.id, name: 'Booking.com', api_key: 'bdc_test_key_xxxxxxxxxxxx', hotel_id_on_channel: 'INH20021', commission_pct: 15, active: true },
    { tenant_id: tenant1.id, name: 'MakeMyTrip',  api_key: 'mmt_test_key_xxxxxxxxxxxx', hotel_id_on_channel: 'HTL45221', commission_pct: 12, active: true },
    { tenant_id: tenant1.id, name: 'Expedia',     api_key: 'exp_test_key_xxxxxxxxxxxx', hotel_id_on_channel: 'EXP88712', commission_pct: 18, active: false },
  ]).returning('*');

  await knex('channel_sync_log').insert([
    { channel_id: bdc.id, event: 'Channel connected during initial setup', status: 'success' },
    { channel_id: bdc.id, event: 'Availability pushed: 8 rooms, 90 days',  status: 'success' },
    { channel_id: bdc.id, event: 'Rates synced for all room types',         status: 'success' },
    { channel_id: mmt.id, event: 'Channel connected during initial setup', status: 'success' },
  ]);

  // ── Audit log ─────────────────────────────────────────────────
  await knex('tenant_audit_log').insert([
    { tenant_id: tenant1.id, user_id: superAdmin.id, action: 'TENANT_CREATED', payload: JSON.stringify({ name: tenant1.name, plan: proPlan.name }) },
    { tenant_id: tenant2.id, user_id: superAdmin.id, action: 'TENANT_CREATED', payload: JSON.stringify({ name: tenant2.name, plan: starterPlan.name }) },
    { tenant_id: tenant2.id, user_id: null,          action: 'SUBSCRIPTION_EXPIRED', payload: JSON.stringify({ subscription_end: tenant2.subscription_end }) },
  ]);

  console.log('\n✅  Seed complete.\n');
  console.log('    Role            Email                         Password');
  console.log('    ─────────────────────────────────────────────────────────');
  console.log('    Super Admin     superadmin@hotelpms.io        SuperAdmin@999');
  console.log('    Hotel Admin     admin@hotel.com               Admin@1234');
  console.log('    Manager         manager@hotel.com             Staff@1234');
  console.log('    Receptionist    frontdesk@hotel.com           Staff@1234');
  console.log('    Housekeeping    housekeeping@hotel.com        Staff@1234');
  console.log('\n    ⚠  Sunrise Inn subscription is expired (for testing).\n');
};
