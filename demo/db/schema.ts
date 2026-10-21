import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const journeys = sqliteTable('journeys', { id: text('id').primaryKey(), state: text('state').notNull(), createdAt: integer('created_at').notNull() });
export const jobs = sqliteTable('jobs', { id: text('id').primaryKey(), journey: text('journey').notNull(), action: text('action').notNull(), status: text('status').notNull(), tx: text('tx'), error: text('error'), createdAt: integer('created_at').notNull() });
export const relayLock = sqliteTable('relay_lock', { id: text('id').primaryKey(), jobId: text('job_id').notNull(), until: integer('until').notNull() });
