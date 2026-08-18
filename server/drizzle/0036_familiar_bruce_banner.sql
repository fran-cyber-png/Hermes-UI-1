CREATE TABLE "plantillas_texto" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"titulo" text NOT NULL,
	"texto" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archivado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "plantillas_texto_vendedora_idx" ON "plantillas_texto" USING btree ("vendedora_id","archivado_at");