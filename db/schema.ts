import { sql } from "void/db";
import { integer, sqliteTable, text } from "void/schema-d1";
import type { Layout } from "../lib/layout";

export const orchards = sqliteTable("orchards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const blocks = sqliteTable("blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orchardId: integer("orchard_id")
    .notNull()
    .references(() => orchards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  layout: text("layout", { mode: "json" }).$type<Layout>().notNull().default({ rows: [] }),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
