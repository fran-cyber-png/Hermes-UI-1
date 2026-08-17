ALTER TABLE "notas" ADD COLUMN "tipo" text DEFAULT 'texto' NOT NULL;--> statement-breakpoint
ALTER TABLE "notas" ADD COLUMN "diagrama" jsonb;--> statement-breakpoint
ALTER TABLE "notas" ADD COLUMN "pagina_dividida_id" bigint;--> statement-breakpoint
ALTER TABLE "notas" ADD CONSTRAINT "notas_pagina_dividida_id_notas_id_fk" FOREIGN KEY ("pagina_dividida_id") REFERENCES "public"."notas"("id") ON DELETE no action ON UPDATE no action;