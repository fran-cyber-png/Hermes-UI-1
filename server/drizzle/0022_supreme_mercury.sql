CREATE TABLE "espacio_miembro" (
	"espacio_id" bigint NOT NULL,
	"vendedora_id" text NOT NULL,
	"agregado_por" text NOT NULL,
	"agregado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "espacio_miembro_espacio_id_vendedora_id_pk" PRIMARY KEY("espacio_id","vendedora_id")
);
--> statement-breakpoint
CREATE TABLE "espacios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"creada_por" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archivado_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notas" ADD COLUMN "espacio_id" bigint;--> statement-breakpoint
ALTER TABLE "espacio_miembro" ADD CONSTRAINT "espacio_miembro_espacio_id_espacios_id_fk" FOREIGN KEY ("espacio_id") REFERENCES "public"."espacios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "espacio_miembro_vendedora_idx" ON "espacio_miembro" USING btree (lower("vendedora_id"));--> statement-breakpoint
CREATE INDEX "espacios_creadora_idx" ON "espacios" USING btree ("creada_por");--> statement-breakpoint
ALTER TABLE "notas" ADD CONSTRAINT "notas_espacio_id_espacios_id_fk" FOREIGN KEY ("espacio_id") REFERENCES "public"."espacios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notas_espacio_idx" ON "notas" USING btree ("espacio_id","creado_at") WHERE "notas"."espacio_id" is not null;