CREATE TABLE "equipo" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"rol" text DEFAULT 'vendedora' NOT NULL,
	"origen" text DEFAULT 'cerberus' NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"creada_por" text DEFAULT 'alta-automatica' NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_por" text,
	CONSTRAINT "equipo_rol_ck" CHECK ("equipo"."rol" IN ('admin','supervisor','vendedora')),
	CONSTRAINT "equipo_origen_ck" CHECK ("equipo"."origen" IN ('cerberus','centurion')),
	CONSTRAINT "equipo_id_canonico_ck" CHECK ("equipo"."persona_id" = lower(btrim("equipo"."persona_id")) AND "equipo"."persona_id" <> '')
);
--> statement-breakpoint
CREATE TABLE "equipo_bitacora" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cuando" timestamp with time zone DEFAULT now() NOT NULL,
	"quien" text NOT NULL,
	"fuente" text NOT NULL,
	"que" text NOT NULL,
	"sobre" text NOT NULL,
	"antes" jsonb,
	"despues" jsonb,
	CONSTRAINT "equipo_bitacora_fuente_ck" CHECK ("equipo_bitacora"."fuente" IN ('panel','cerberus','cli','siembra','break-glass'))
);
--> statement-breakpoint
CREATE TABLE "equipo_grafia" (
	"grafia" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"vista_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipo_grafia" ADD CONSTRAINT "equipo_grafia_persona_id_equipo_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."equipo"("persona_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipo_admin_idx" ON "equipo" USING btree ("persona_id") WHERE "equipo"."rol" = 'admin' AND "equipo"."activa";--> statement-breakpoint
CREATE INDEX "equipo_bitacora_sobre_idx" ON "equipo_bitacora" USING btree ("sobre","cuando" DESC NULLS LAST);