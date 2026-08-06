CREATE TABLE "reacciones_wa" (
	"mensaje_external_id" text NOT NULL,
	"de_persona" text NOT NULL,
	"emoji" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reacciones_wa_mensaje_external_id_de_persona_pk" PRIMARY KEY("mensaje_external_id","de_persona")
);
--> statement-breakpoint
CREATE INDEX "reacciones_wa_mensaje_idx" ON "reacciones_wa" USING btree ("mensaje_external_id");