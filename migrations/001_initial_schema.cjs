exports.up = async function (knex) {
  // Users
  await knex.schema.createTable('users', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('email').unique().notNullable();
    t.string('password_hash').notNullable();
    t.enum('role', ['admin', 'manager', 'receptionist']).defaultTo('receptionist');
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
  });

  // Rooms
  await knex.schema.createTable('rooms', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('number').unique().notNullable();
    t.enum('type', ['Standard', 'Deluxe', 'Suite', 'Junior Suite', 'Presidential']).notNullable();
    t.integer('floor').defaultTo(1);
    t.integer('max_occupancy').defaultTo(2);
    t.decimal('base_rate', 10, 2).notNullable();
    t.text('description');
    t.enum('status', ['available', 'occupied', 'reserved', 'closed', 'maintenance']).defaultTo('available');
    t.timestamps(true, true);
  });

  // Inventory closures
  await knex.schema.createTable('inventory_closures', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('room_id').references('id').inTable('rooms').onDelete('CASCADE');
    t.date('from_date').notNullable();
    t.date('to_date').notNullable();
    t.enum('reason', ['Maintenance', 'Renovation', 'Owner block', 'Event', 'Other']).defaultTo('Maintenance');
    t.uuid('created_by').references('id').inTable('users').nullable();
    t.timestamps(true, true);
  });

  // Reservations
  await knex.schema.createTable('reservations', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('res_number').unique().notNullable();
    t.uuid('room_id').references('id').inTable('rooms').notNullable();
    t.string('first_name').notNullable();
    t.string('last_name').notNullable();
    t.string('email');
    t.string('phone');
    t.date('check_in').notNullable();
    t.date('check_out').notNullable();
    t.integer('adults').defaultTo(1);
    t.integer('children').defaultTo(0);
    t.string('source').defaultTo('direct');
    t.string('id_type');
    t.string('id_number');
    t.text('notes');
    t.decimal('rate_per_night', 10, 2).notNullable();
    t.decimal('total_amount', 10, 2).notNullable();
    t.enum('status', ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']).defaultTo('confirmed');
    t.timestamp('actual_check_in');
    t.timestamp('actual_check_out');
    t.uuid('created_by').references('id').inTable('users').nullable();
    t.uuid('checked_in_by').references('id').inTable('users').nullable();
    t.uuid('checked_out_by').references('id').inTable('users').nullable();
    t.timestamps(true, true);
  });

  // Rates
  await knex.schema.createTable('rates', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enum('room_type', ['Standard', 'Deluxe', 'Suite', 'Junior Suite', 'Presidential']).notNullable();
    t.string('season').notNullable();
    t.decimal('price_per_night', 10, 2).notNullable();
    t.date('valid_from');
    t.date('valid_to');
    t.timestamps(true, true);
  });

  // Invoices
  await knex.schema.createTable('invoices', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('inv_number').unique().notNullable();
    t.uuid('reservation_id').references('id').inTable('reservations').nullable();
    t.uuid('room_id').references('id').inTable('rooms').notNullable();
    t.string('guest_name').notNullable();
    t.string('guest_email');
    t.string('guest_phone');
    t.timestamp('check_in').notNullable();
    t.timestamp('check_out').notNullable();
    t.integer('nights').notNullable();
    t.decimal('rate_per_night', 10, 2).notNullable();
    t.decimal('room_charges', 10, 2).notNullable();
    t.integer('tax_rate').defaultTo(12);
    t.decimal('tax_amount', 10, 2).notNullable();
    t.decimal('grand_total', 10, 2).notNullable();
    t.enum('status', ['unpaid', 'paid', 'cancelled']).defaultTo('unpaid');
    t.string('payment_method');
    t.timestamp('paid_at');
    t.uuid('created_by').references('id').inTable('users').nullable();
    t.timestamps(true, true);
  });

  // Channels
  await knex.schema.createTable('channels', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.text('api_key').notNullable();
    t.string('hotel_id_on_channel').notNullable();
    t.decimal('commission_pct', 5, 2).defaultTo(0);
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
  });

  // Channel sync log
  await knex.schema.createTable('channel_sync_log', t => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('channel_id').references('id').inTable('channels').onDelete('CASCADE');
    t.text('event').notNullable();
    t.enum('status', ['success', 'error', 'info']).defaultTo('info');
    t.jsonb('payload');
    t.timestamps(true, true);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('channel_sync_log');
  await knex.schema.dropTableIfExists('channels');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('rates');
  await knex.schema.dropTableIfExists('reservations');
  await knex.schema.dropTableIfExists('inventory_closures');
  await knex.schema.dropTableIfExists('rooms');
  await knex.schema.dropTableIfExists('users');
};
