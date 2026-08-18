CREATE TABLE "remitentes_correo" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"direccion" text NOT NULL,
	"nombre" text NOT NULL,
	"responder_a" text,
	"firma" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_por" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correos" ADD COLUMN "remitente_id" bigint;--> statement-breakpoint
ALTER TABLE "correos" ADD COLUMN "desde" text;--> statement-breakpoint
ALTER TABLE "correos" ADD COLUMN "responder_a" text;--> statement-breakpoint
ALTER TABLE "correos" ADD COLUMN "id_externo" text;--> statement-breakpoint
CREATE UNIQUE INDEX "remitentes_correo_direccion_uq" ON "remitentes_correo" USING btree (lower("direccion"));