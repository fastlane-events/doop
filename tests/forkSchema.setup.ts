/* fork (fastlane-events/doop): upstream's tests build databases with drizzle's
   migrate() on server/db/migrations. Our scoped-guidelines schema is not a
   migration (server/db/forkSchema.ts says why), so every migrate() in a test
   applies it right after, as initDb does at boot. */
import { vi } from 'vitest'
import { FORK_SCHEMA } from '../server/db/forkSchema.ts'

vi.mock('drizzle-orm/pglite/migrator', async (importOriginal) => {
  const original = await importOriginal<typeof import('drizzle-orm/pglite/migrator')>()
  return {
    ...original,
    migrate: async (...args: Parameters<typeof original.migrate>) => {
      await original.migrate(...args)
      /* the PGlite client under drizzle: exec runs several statements at once */
      const { $client } = args[0] as unknown as { $client: { exec(sql: string): Promise<unknown> } }
      await $client.exec(FORK_SCHEMA)
    },
  }
})
