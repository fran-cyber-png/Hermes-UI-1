CREATE TABLE "contacto_habilitado" (
	"contacto_id" bigint PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"habilitado_por" text NOT NULL,
	"habilitado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contacto_habilitado_vendedora_idx" ON "contacto_habilitado" USING btree ("vendedora_id");