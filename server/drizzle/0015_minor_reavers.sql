CREATE TABLE "conversacion_asignada" (
	"clave" text PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"numero_propio" text NOT NULL,
	"motivo" text DEFAULT 'round-robin' NOT NULL,
	"asignada_por" text,
	"asignada_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reparto_rueda" (
	"numero_propio" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activa" text DEFAULT 'si' NOT NULL,
	"agregada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reparto_rueda_numero_propio_vendedora_id_pk" PRIMARY KEY("numero_propio","vendedora_id")
);
--> statement-breakpoint
CREATE INDEX "conversacion_asignada_vendedora_idx" ON "conversacion_asignada" USING btree ("vendedora_id");--> statement-breakpoint
CREATE INDEX "conversacion_asignada_linea_idx" ON "conversacion_asignada" USING btree ("numero_propio");