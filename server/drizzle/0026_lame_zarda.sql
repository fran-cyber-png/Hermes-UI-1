CREATE TABLE "campana_cable" (
	"numero_propio" text NOT NULL,
	"campana_id" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"asignada_por" text,
	"asignada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campana_cable_numero_propio_campana_id_vendedora_id_pk" PRIMARY KEY("numero_propio","campana_id","vendedora_id")
);
--> statement-breakpoint
CREATE TABLE "campana_meta" (
	"campana_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"estado" text NOT NULL,
	"numeros" text[] DEFAULT '{}' NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curso_ruteo" (
	"curso" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"asignada_por" text,
	"asignada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curso_ruteo_curso_vendedora_id_pk" PRIMARY KEY("curso","vendedora_id")
);
--> statement-breakpoint
-- El backfill: lo que hubiera quedado en la tabla vieja se muda tal cual. Cada
-- fila de campana_ruteo era una campana con UNA vendedora, o sea el unico cable
-- de esa campana. Es idempotente por la PK.
--
-- En produccion esto mueve CERO filas (la 0025 todavia no se aplico), pero en
-- staging la 0025 si corrio y ahi puede haber reglas de prueba: perderlas
-- silenciosamente al cambiar de tabla seria justo el fallo mudo que este frente
-- evita en todos lados.
INSERT INTO "campana_cable" ("numero_propio", "campana_id", "vendedora_id", "asignada_por", "asignada_en")
SELECT "numero_propio", "campana_id", "vendedora_id", "asignada_por", "asignada_en"
  FROM "campana_ruteo"
ON CONFLICT DO NOTHING;
