CREATE TABLE "contacto_territorio" (
	"clave" text PRIMARY KEY NOT NULL,
	"distrito_id" integer NOT NULL,
	"anotado_por" text,
	"anotado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distrito" (
	"id" serial PRIMARY KEY NOT NULL,
	"linea" text NOT NULL,
	"nombre" text NOT NULL,
	"zona" text,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacto_territorio" ADD CONSTRAINT "contacto_territorio_distrito_id_distrito_id_fk" FOREIGN KEY ("distrito_id") REFERENCES "public"."distrito"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacto_territorio_distrito_idx" ON "contacto_territorio" USING btree ("distrito_id");--> statement-breakpoint
CREATE UNIQUE INDEX "distrito_linea_nombre_uq" ON "distrito" USING btree ("linea",lower(btrim("nombre")));--> statement-breakpoint
CREATE INDEX "distrito_linea_idx" ON "distrito" USING btree ("linea","activo");