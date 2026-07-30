CREATE TABLE "bot_calificaciones" (
	"clave" text PRIMARY KEY NOT NULL,
	"temperatura" text,
	"motivo" text,
	"escalada" boolean DEFAULT false NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_estado" (
	"numero_propio" text PRIMARY KEY NOT NULL,
	"modo" text DEFAULT 'apagado' NOT NULL,
	"frenado_motivo" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por" text
);
--> statement-breakpoint
CREATE TABLE "bot_followups" (
	"clave" text PRIMARY KEY NOT NULL,
	"motivo" text NOT NULL,
	"enviado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_pausas" (
	"clave" text PRIMARY KEY NOT NULL,
	"motivo" text NOT NULL,
	"hasta" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_pendientes" (
	"clave" text PRIMARY KEY NOT NULL,
	"numero_propio" text NOT NULL,
	"ultimo_entrante_en" timestamp with time zone NOT NULL,
	"procesar_desde" timestamp with time zone NOT NULL,
	"en_proceso_desde" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_respuestas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"numero_propio" text NOT NULL,
	"texto" text,
	"acciones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estado" text NOT NULL,
	"motivo" text,
	"modelo" text,
	"tokens_entrada" integer,
	"tokens_salida" integer,
	"tokens_cache_escritura" integer,
	"tokens_cache_lectura" integer,
	"revision" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_pendientes_turno_idx" ON "bot_pendientes" USING btree ("procesar_desde","en_proceso_desde");--> statement-breakpoint
CREATE INDEX "bot_respuestas_estado_idx" ON "bot_respuestas" USING btree ("estado","creado_en");--> statement-breakpoint
CREATE INDEX "bot_respuestas_clave_idx" ON "bot_respuestas" USING btree ("clave");