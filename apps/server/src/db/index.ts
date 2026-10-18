import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

/** Create connections explicitly; importing this module never contacts PostgreSQL. */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 })
  return { db: drizzle(pool), close: () => pool.end() }
}
