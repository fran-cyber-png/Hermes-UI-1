CREATE TABLE "eventos_contacto" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"tipo" text NOT NULL,
	"curso" text,
	"producto_id" text,
	"nota" text,
	"vendedora_id" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"editado_at" timestamp with time zone,
	"archivado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "eventos_contacto_clave_idx" ON "eventos_contacto" USING btree ("clave","creado_at" DESC NULLS LAST);