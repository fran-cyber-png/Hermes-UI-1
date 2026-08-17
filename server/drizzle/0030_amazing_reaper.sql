CREATE TABLE "nota_link_evento" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nota_id" bigint NOT NULL,
	"etiqueta" text NOT NULL,
	"evento" text NOT NULL,
	"quien" text,
	"alcance" text,
	"permiso" text,
	"vence_at" timestamp with time zone,
	"motivo" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nota_link_evento" ADD CONSTRAINT "nota_link_evento_nota_id_notas_id_fk" FOREIGN KEY ("nota_id") REFERENCES "public"."notas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nota_link_evento_nota_idx" ON "nota_link_evento" USING btree ("nota_id","at");