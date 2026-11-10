import { env } from '../env.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.ts'

/**
 * DATABASE_URL set   -> real Postgres (production: Railway/Fly managed PG)
 * DATABASE_URL unset -> PGlite, an embedded Postgres persisted to ./data/pg
 * Same dialect, same schema, same queries either way.
 *
 * Schema changes: edit schema.ts / auth-schema.ts, then `npx drizzle-kit
 * generate` — the SQL lands in ./migrations and is applied here at boot.
 * Migration 0000 doubles as a baseline: fully idempotent, so databases
 * created by the pre-migration boot DDL adopt the journal cleanly.
 */

export type Db = NodePgDatabase<typeof schema>

export let db: Db

/* resolved from this file, not process.cwd() — the server may be launched
   from anywhere (tests spawn it from a temp working directory) */
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

/* fork: our scoped-guidelines migration first shipped as 0029 (journal
   `when` below), later than upstream's 0029 although upstream's 0029..0050
   came after it. drizzle applies only migrations newer than the last row in
   its journal, so a database that ran ours would skip upstream's 0029. Its
   row is moved back to 0028's time: upstream's then all run, and ours runs
   again as the idempotent 0051. A no-op on any other database. */
const OLD_FORK_MIGRATION_AT = 1792126289040
const BEFORE_IT_AT = 1791579850954 // 0028_slack_agent

async function rewindForkMigration(execute: (query: string) => Promise<unknown>): Promise<void> {
  await execute(`DO $$ BEGIN
    IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
      UPDATE drizzle.__drizzle_migrations SET created_at = ${BEFORE_IT_AT} WHERE created_at = ${OLD_FORK_MIGRATION_AT};
    END IF;
  END $$`)
}

export async function initDb(): Promise<void> {
  const url = env.DATABASE_URL
  if (url) {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    db = drizzle(url, { schema })
    await rewindForkMigration((query) => db.execute(query))
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(db, { migrationsFolder: MIGRATIONS })
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const dir = path.join(process.cwd(), 'data', 'pg')
    fs.mkdirSync(dir, { recursive: true }) // PGlite's own mkdir isn't recursive
    const client = new PGlite(dir)
    const pgliteDb = drizzle(client, { schema })
    await rewindForkMigration((query) => client.exec(query))
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(pgliteDb, { migrationsFolder: MIGRATIONS })
    db = pgliteDb as unknown as Db
  }
}
