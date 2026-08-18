CREATE TABLE "contacto_ficha" (
	"clave" text PRIMARY KEY NOT NULL,
	"telefono" text,
	"nombre" text,
	"apellido" text,
	"empresa" text,
	"email" text,
	"prioridad" text,
	"vendedora_id" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recordatorios" ADD COLUMN "tipo" text DEFAULT 'seguimiento' NOT NULL;--> statement-breakpoint
ALTER TABLE "recordatorios" ADD COLUMN "duracion_min" integer;--> statement-breakpoint
ALTER TABLE "recordatorios" ADD COLUMN "importancia" text;--> statement-breakpoint
CREATE INDEX "contacto_ficha_telefono_idx" ON "contacto_ficha" USING btree ("telefono");