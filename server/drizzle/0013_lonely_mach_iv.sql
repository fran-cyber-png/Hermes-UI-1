CREATE TABLE "corrida_respuestas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"corrida_id" bigint NOT NULL,
	"clave" text NOT NULL,
	"numero_propio" text NOT NULL,
	"texto_original" text,
	"estado_original" text,
	"texto" text,
	"estado" text NOT NULL,
	"motivo" text,
	"acciones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modelo" text,
	"tokens_entrada" integer,
	"tokens_salida" integer,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corridas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rotulo" text NOT NULL,
	"lanzada_por" text NOT NULL,
	"contexto" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estado" text DEFAULT 'corriendo' NOT NULL,
	"motivo" text,
	"pedidas" integer DEFAULT 0 NOT NULL,
	"corridas" integer DEFAULT 0 NOT NULL,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_salida" integer DEFAULT 0 NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"terminada_en" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "corrida_respuestas" ADD CONSTRAINT "corrida_respuestas_corrida_id_corridas_id_fk" FOREIGN KEY ("corrida_id") REFERENCES "public"."corridas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrida_respuestas_corrida_idx" ON "corrida_respuestas" USING btree ("corrida_id");--> statement-breakpoint
CREATE INDEX "corrida_respuestas_clave_idx" ON "corrida_respuestas" USING btree ("clave");--> statement-breakpoint
CREATE INDEX "corridas_creada_idx" ON "corridas" USING btree ("creada_en");