import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  normalizedUsername: text("normalized_username").notNull().unique(),
  passwordHash: text("password_hash"),
  official: boolean("official").notNull().default(false),
  /** The platform boss: a private bot that players challenge outside the rankings. */
  boss: boolean("boss").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
