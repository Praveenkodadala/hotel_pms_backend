/**
 * Migration 003: Invoice fixes + enhancements
 *
 * invoice_sequences: uses TEXT primary key (not UUID) so it works
 * whether or not a tenant_id exists. Format: tenant_id UUID string OR
 * the literal string 'global' for non-tenant invoices.
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('invoices', (t) => {
    t.uuid('tenant_id').references('id').inTable('tenants').nullable();
    t.jsonb('line_items').defaultTo('[]');
    t.decimal('extras_total', 10, 2).defaultTo(0);
    t.string('payment_reference').nullable();
    t.text('notes');
    t.string('invoice_type').defaultTo('standard'); // standard|credit_note|proforma
    t.uuid('original_invoice_id').references('id').inTable('invoices').nullable();
  });

  // TEXT primary key — accepts both UUID strings and 'global' fallback
  await knex.schema.createTable('invoice_sequences', (t) => {
    t.text('seq_key').primary(); // tenant UUID or 'global'
    t.integer('last_seq').defaultTo(0);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('invoice_sequences');
  await knex.schema.alterTable('invoices', (t) => {
    t.dropColumn('tenant_id');
    t.dropColumn('line_items');
    t.dropColumn('extras_total');
    t.dropColumn('payment_reference');
    t.dropColumn('notes');
    t.dropColumn('invoice_type');
    t.dropColumn('original_invoice_id');
  });
};
