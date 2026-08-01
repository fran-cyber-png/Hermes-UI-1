CREATE TABLE "bot_estado_conversacion" (
	"clave" text PRIMARY KEY NOT NULL,
	"estado" text DEFAULT 'desconocido' NOT NULL,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_estado_conv_estado_idx" ON "bot_estado_conversacion" USING btree ("estado","actualizado_en");