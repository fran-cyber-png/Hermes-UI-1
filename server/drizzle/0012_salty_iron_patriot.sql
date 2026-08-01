CREATE TABLE "bot_memoria_lead" (
	"clave" text PRIMARY KEY NOT NULL,
	"hechos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
