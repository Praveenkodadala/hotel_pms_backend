/**
 * Migration 004: Add tenant_id to channels table
 * Channels were not tenant-scoped in migration 001
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('channels', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable().after('id');
  });

  // Add tenant_id to rates table for future per-hotel rate management
  await knex.schema.alterTable('rates', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable().after('id');
  });

  // Add tenant_id to reservations for direct scoping without room join
  await knex.schema.alterTable('reservations', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable().after('id');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('reservations', (t) => { t.dropColumn('tenant_id'); });
  await knex.schema.alterTable('rates', (t) => { t.dropColumn('tenant_id'); });
  await knex.schema.alterTable('channels', (t) => { t.dropColumn('tenant_id'); });
};
