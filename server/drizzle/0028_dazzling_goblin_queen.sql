CREATE TABLE "curso_ruteo" (
	"curso" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"asignada_por" text,
	"asignada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "curso_ruteo_curso_vendedora_id_pk" PRIMARY KEY("curso","vendedora_id")
);
