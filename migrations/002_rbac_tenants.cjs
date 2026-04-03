/**
 * Migration 002: Multi-tenant RBAC
 * NOTE: PostgreSQL does not support .after() for column ordering.
 * Columns are added at the end of the table — order doesn't matter in PG.
 */

exports.up = async function (knex) {
  // ── Subscription plans ─────────────────────────────────────────
  await knex.schema.createTable('subscription_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.text('description');
    t.decimal('price_monthly', 10, 2).defaultTo(0);
    t.integer('max_rooms').defaultTo(50);
    t.integer('max_users').defaultTo(10);
    t.jsonb('features').defaultTo('{}');
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Tenants (Hotels / Clients) ──────────────────────────────────
  await knex.schema.createTable('tenants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('slug').unique().notNullable();
    t.string('email').notNullable();
    t.string('phone');
    t.string('website');
    t.text('address');
    t.string('city');
    t.string('state');
    t.string('country').defaultTo('India');
    t.string('pincode');
    t.string('gstin');
    t.string('pan');
    t.string('tan');
    t.uuid('plan_id').references('id').inTable('subscription_plans').nullable();
    t.date('subscription_start');
    t.date('subscription_end');
    t.boolean('subscription_active').defaultTo(true);
    t.enum('status', ['active', 'disabled', 'suspended', 'pending']).defaultTo('active');
    t.text('disable_reason');
    t.string('logo_url');
    t.string('primary_color').defaultTo('#185FA5');
    t.jsonb('payment_meta').defaultTo('{}');
    t.timestamps(true, true);
  });

  // ── Extend users table (PG: .after() not supported — columns append to end) ──
  await knex.schema.alterTable('users', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable();
    t.string('phone');
    t.enum('status', ['active', 'disabled', 'invited']).defaultTo('active');
    t.timestamp('last_login_at').nullable();
    t.uuid('created_by').references('id').inTable('users').nullable();
  });

  // Change role enum to include all roles
  await knex.raw(`
    ALTER TABLE users
    DROP COLUMN IF EXISTS role
  `);
  await knex.raw(`
    ALTER TABLE users
    ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'receptionist'
  `);

  // ── Extend rooms table ─────────────────────────────────────────
  await knex.schema.alterTable('rooms', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable();
    t.string('housekeeping_status').defaultTo('clean'); // clean|dirty|in_progress|inspected
    t.uuid('assigned_hk_user').references('id').inTable('users').nullable();
    t.timestamp('hk_started_at').nullable();
    t.timestamp('hk_completed_at').nullable();
  });

  // ── Housekeeping tasks ──────────────────────────────────────────
  await knex.schema.createTable('housekeeping_tasks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').references('id').inTable('tenants').nullable();
    t.uuid('room_id').references('id').inTable('rooms').onDelete('CASCADE');
    t.uuid('reservation_id').references('id').inTable('reservations').nullable();
    t.uuid('assigned_to').references('id').inTable('users').nullable();
    t.uuid('created_by').references('id').inTable('users').nullable();
    t.string('status').defaultTo('pending'); // pending|assigned|in_progress|completed|inspected|cancelled
    t.string('priority').defaultTo('normal'); // low|normal|high|urgent
    t.text('notes');
    t.text('completion_notes');
    t.jsonb('checklist').defaultTo('[]');
    t.timestamp('started_at').nullable();
    t.timestamp('completed_at').nullable();
    t.timestamp('inspected_at').nullable();
    t.uuid('inspected_by').references('id').inTable('users').nullable();
    t.timestamps(true, true);
  });

  // ── Tenant activity log ─────────────────────────────────────────
  await knex.schema.createTable('tenant_audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('tenant_id').references('id').inTable('tenants').nullable();
    t.uuid('user_id').references('id').inTable('users').nullable();
    t.string('action').notNullable();
    t.jsonb('payload').defaultTo('{}');
    t.string('ip_address');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('tenant_audit_log');
  await knex.schema.dropTableIfExists('housekeeping_tasks');
  await knex.schema.alterTable('rooms', (t) => {
    t.dropColumn('tenant_id');
    t.dropColumn('housekeeping_status');
    t.dropColumn('assigned_hk_user');
    t.dropColumn('hk_started_at');
    t.dropColumn('hk_completed_at');
  });
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('tenant_id');
    t.dropColumn('status');
    t.dropColumn('phone');
    t.dropColumn('last_login_at');
    t.dropColumn('created_by');
  });
  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS role`);
  await knex.raw(`ALTER TABLE users ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'receptionist'`);
  await knex.schema.dropTableIfExists('tenants');
  await knex.schema.dropTableIfExists('subscription_plans');
};
