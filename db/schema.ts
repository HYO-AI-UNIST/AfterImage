import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The private game state and token hashes are server-only. Public room views are
// constructed by the game engine; this payload is never returned by a route.
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  version: integer('version').notNull(),
  payload: text('payload').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
