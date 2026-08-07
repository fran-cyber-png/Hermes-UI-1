CREATE TABLE "corridas_campana" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pieza_ref" text NOT NULL,
	"pieza_version" text,
	"numero_propio" text NOT NULL,
	"lista_id" text,
	"filtros" jsonb,
	"autorizada_por" text NOT NULL,
	"autorizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"total_previsto" integer NOT NULL,
	"estado" text DEFAULT 'despachando' NOT NULL,
	"frenada_por" text,
	"frenada_en" timestamp with time zone,
	"motivo_del_freno" text,
	"terminada_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listas_campana" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"filtros" jsonb NOT NULL,
	"nota" text,
	"creada_por" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"archivada_en" timestamp with time zone,
	CONSTRAINT "listas_campana_nombre_uq" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE INDEX "corridas_campana_pieza_idx" ON "corridas_campana" USING btree ("pieza_ref","autorizada_en");--> statement-breakpoint
CREATE INDEX "corridas_campana_quien_idx" ON "corridas_campana" USING btree ("autorizada_por");--> statement-breakpoint
CREATE INDEX "corridas_campana_estado_idx" ON "corridas_campana" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "listas_campana_vivas_idx" ON "listas_campana" USING btree ("archivada_en");