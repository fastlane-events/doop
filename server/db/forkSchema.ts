/* fork (fastlane-events/doop): the scoped-guidelines tables. They are not a
   drizzle migration on purpose: upstream numbers its migrations 0000, 0001, …
   and a fork migration in the same folder collides with each new upstream one
   (number, journal, snapshot). Instead this idempotent SQL runs after
   upstream's migrations on every boot (server/db/index.ts, and in tests
   tests/forkSchema.setup.ts after any migrate()). It must stay idempotent and additive.
   Databases that ran it earlier as the migrations 0029_ or 0051_scoped_guidelines
   keep those journal rows; drizzle ignores rows it has no file for, and every
   later upstream migration is newer than them, so none is skipped. */
export const FORK_SCHEMA = `
CREATE TABLE IF NOT EXISTS "scoped_guideline_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "name" text NOT NULL,
  "markdown" text NOT NULL,
  "saved_at" bigint NOT NULL,
  "saved_by" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "scoped_guidelines" (
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "name" text NOT NULL,
  "markdown" text NOT NULL,
  "title" text,
  "kind" text DEFAULT 'style' NOT NULL,
  "updated_at" bigint NOT NULL,
  "updated_by" text NOT NULL,
  CONSTRAINT "scoped_guidelines_scope_type_scope_id_name_pk" PRIMARY KEY("scope_type","scope_id","name")
);
ALTER TABLE "guidelines" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'style' NOT NULL;
CREATE INDEX IF NOT EXISTS "scoped_guideline_versions_doc_idx" ON "scoped_guideline_versions" USING btree ("scope_type","scope_id","name");
`
