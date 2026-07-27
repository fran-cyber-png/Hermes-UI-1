ALTER TABLE "envios_wa" ADD COLUMN "pieza_clase" text;--> statement-breakpoint
ALTER TABLE "envios_wa" ADD COLUMN "pieza_ref" text;--> statement-breakpoint
ALTER TABLE "envios_wa" ADD COLUMN "pieza_version" text;--> statement-breakpoint
ALTER TABLE "envios_wa" ADD COLUMN "pieza_via" text;--> statement-breakpoint
ALTER TABLE "envios_wa" ADD COLUMN "pieza_editada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "envios_wa" ADD COLUMN "momento_venta" text;--> statement-breakpoint
CREATE INDEX "envios_wa_pieza_idx" ON "envios_wa" USING btree ("pieza_clase","pieza_ref","pieza_version");--> statement-breakpoint
CREATE INDEX "envios_wa_referencia_idx" ON "envios_wa" USING btree ("referencia","creado_at");