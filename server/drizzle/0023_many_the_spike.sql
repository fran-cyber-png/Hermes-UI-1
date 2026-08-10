CREATE TABLE "nota_link" (
	"token" text PRIMARY KEY NOT NULL,
	"nota_id" bigint NOT NULL,
	"creado_por" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nota_link" ADD CONSTRAINT "nota_link_nota_id_notas_id_fk" FOREIGN KEY ("nota_id") REFERENCES "public"."notas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nota_link_nota_uq" ON "nota_link" USING btree ("nota_id");