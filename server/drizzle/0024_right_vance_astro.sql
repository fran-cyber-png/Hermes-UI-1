ALTER TABLE "nota_link" ADD COLUMN "alcance" text DEFAULT 'publico' NOT NULL;--> statement-breakpoint
ALTER TABLE "nota_link" ADD COLUMN "permiso" text DEFAULT 'ver' NOT NULL;--> statement-breakpoint
ALTER TABLE "nota_link" ADD COLUMN "vence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nota_link" ADD COLUMN "ultimo_acceso_at" timestamp with time zone;