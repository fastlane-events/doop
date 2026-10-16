CREATE TABLE "scoped_guideline_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"name" text NOT NULL,
	"markdown" text NOT NULL,
	"saved_at" bigint NOT NULL,
	"saved_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoped_guidelines" (
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
--> statement-breakpoint
ALTER TABLE "guidelines" ADD COLUMN "kind" text DEFAULT 'style' NOT NULL;--> statement-breakpoint
CREATE INDEX "scoped_guideline_versions_doc_idx" ON "scoped_guideline_versions" USING btree ("scope_type","scope_id","name");
