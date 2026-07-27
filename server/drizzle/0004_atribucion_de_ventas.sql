CREATE TABLE "ventas_no_atribuidas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"external_sale_id" text NOT NULL,
	"folio" text,
	"vendedora_id" text,
	"monto" numeric,
	"moneda" text,
	"medio" text,
	"origen_venta" text,
	"estado_venta" integer,
	"estado_pago" text,
	"cerberus_cliente_id" bigint,
	"telefonos" integer DEFAULT 0 NOT NULL,
	"motivo" text NOT NULL,
	"fuente_venta" text NOT NULL,
	"ocurrida_at" timestamp with time zone,
	"vista_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "external_sale_id" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "folio" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "monto" numeric;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "moneda" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "medio" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "origen_venta" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "estado_venta" integer;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "estado_pago" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "clave" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "canal" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "numero_propio" text;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "atribucion" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "fuente_venta" text DEFAULT 'hermes' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversiones_wa" ADD COLUMN "ocurrida_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "ventas_no_atribuidas_uq" ON "ventas_no_atribuidas" USING btree ("external_sale_id");--> statement-breakpoint
CREATE INDEX "ventas_no_atribuidas_motivo_idx" ON "ventas_no_atribuidas" USING btree ("motivo");--> statement-breakpoint
CREATE UNIQUE INDEX "conversiones_wa_venta_uq" ON "conversiones_wa" USING btree ("external_sale_id") WHERE external_sale_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversiones_wa_folio_uq" ON "conversiones_wa" USING btree ("folio") WHERE folio IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversiones_wa_clave_idx" ON "conversiones_wa" USING btree ("clave");