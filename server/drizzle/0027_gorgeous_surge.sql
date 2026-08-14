CREATE TABLE "ediciones_wa" (
	"mensaje_external_id" text PRIMARY KEY NOT NULL,
	"texto" text NOT NULL,
	"editado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ediciones_wa_mensaje_idx" ON "ediciones_wa" USING btree ("mensaje_external_id");