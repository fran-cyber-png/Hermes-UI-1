CREATE TABLE "campana_anuncio" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"campana_id" text NOT NULL,
	"campana_nombre" text NOT NULL,
	"estado" text NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campana_ruteo" (
	"numero_propio" text NOT NULL,
	"campana_id" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"asignada_por" text,
	"asignada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campana_ruteo_numero_propio_campana_id_pk" PRIMARY KEY("numero_propio","campana_id")
);
--> statement-breakpoint
CREATE INDEX "campana_anuncio_campana_idx" ON "campana_anuncio" USING btree ("campana_id");