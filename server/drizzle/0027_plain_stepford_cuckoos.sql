CREATE TABLE "campana_meta" (
	"campana_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"estado" text NOT NULL,
	"numeros" text[] DEFAULT '{}' NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
