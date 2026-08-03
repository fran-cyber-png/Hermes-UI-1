CREATE TABLE "lecciones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"texto" text NOT NULL,
	"motivo" text,
	"estado" text DEFAULT 'borrador' NOT NULL,
	"numero_propio" text,
	"creada_por" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"publicada_por" text,
	"publicada_en" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "lecciones_estado_idx" ON "lecciones" USING btree ("estado");