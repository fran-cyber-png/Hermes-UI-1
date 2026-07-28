CREATE TABLE "sesiones_cerberus" (
	"vendedora_id" text PRIMARY KEY NOT NULL,
	"sesion" jsonb NOT NULL,
	"guardada_en" timestamp with time zone DEFAULT now() NOT NULL
);
