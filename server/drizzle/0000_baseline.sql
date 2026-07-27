-- AGREGADO A MANO, no lo genera drizzle-kit: `rag.documentos` declara una columna
-- `vector(1024)` y un índice HNSW, y ese tipo no existe hasta crear la extensión.
-- Sin esta línea la migración muere con 42704 sobre una base limpia — es el mismo
-- tropiezo que ya está documentado en `src/pruebas/montarBase.ts` (la extensión va
-- ANTES del schema, siempre). Si algún día se regenera el baseline, vuelve a hacer falta.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "fuentes";
--> statement-breakpoint
CREATE SCHEMA "ontologia";
--> statement-breakpoint
CREATE SCHEMA "rag";
--> statement-breakpoint
CREATE TABLE "ontologia"."cliente" (
	"codigo" text PRIMARY KEY NOT NULL,
	"nombre" text,
	"apellido" text,
	"dni" text,
	"pais_nombre" text,
	"email" text,
	"telefono" text,
	"moodle_user_id" text,
	"persona_id" bigint,
	"fecha_registro" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ontologia"."cuota" (
	"codigo" text PRIMARY KEY NOT NULL,
	"venta_folio" text NOT NULL,
	"numero_cuotas" integer,
	"monto_total" numeric(16, 2),
	"monto_usd" numeric(16, 2),
	"estado" integer,
	"fecha_vencimiento" timestamp with time zone,
	"fecha_registro" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ontologia"."detalle_venta" (
	"codigo" text PRIMARY KEY NOT NULL,
	"venta_folio" text NOT NULL,
	"producto_codigo" text,
	"cantidad" integer,
	"precio_venta" numeric(14, 2),
	"precio_total" numeric(14, 2),
	"precio_usd" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "ontologia"."pago" (
	"codigo" text PRIMARY KEY NOT NULL,
	"cuota_codigo" text,
	"venta_folio" text,
	"monto" numeric(16, 2),
	"moneda_iso" text,
	"monto_usd" numeric(16, 2),
	"metodo_pago" text,
	"metodo_nombre" text,
	"estado" integer,
	"valido" boolean DEFAULT false NOT NULL,
	"fecha_pago" timestamp with time zone,
	"fecha_confirmacion" timestamp with time zone,
	"latencia_dias" numeric(8, 2),
	"usuario_confirmacion" text
);
--> statement-breakpoint
CREATE TABLE "ontologia"."producto" (
	"codigo" text PRIMARY KEY NOT NULL,
	"nombre" text,
	"sku" text,
	"categoria" text,
	"negocio" text,
	"precio_normal" numeric(14, 2),
	"id_curso_moodle" text
);
--> statement-breakpoint
CREATE TABLE "ontologia"."venta" (
	"folio" text PRIMARY KEY NOT NULL,
	"folio_humano" text,
	"cliente_codigo" text,
	"pais_cliente" text,
	"monto_total" numeric(16, 2),
	"moneda_iso" text,
	"monto_usd" numeric(16, 2),
	"estado" integer,
	"estado_semantico" text,
	"cobrada" boolean DEFAULT false NOT NULL,
	"fecha_venta" timestamp with time zone,
	"medio_venta" text,
	"origen_venta" text,
	"sede" text,
	"vendedor" text
);
--> statement-breakpoint
CREATE TABLE "ontologia"."hechos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sujeto_tipo" text NOT NULL,
	"sujeto_id" text NOT NULL,
	"ocurrido_at" timestamp with time zone NOT NULL,
	"derivado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clave_natural" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontologia"."conversiones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"persona_id" bigint,
	"origen_clave" text NOT NULL,
	"origen_fuente" text DEFAULT 'cerberus' NOT NULL,
	"tipo" text NOT NULL,
	"valor" numeric(14, 2),
	"moneda" text,
	"ocurrido_en" timestamp with time zone NOT NULL,
	"event_id" text NOT NULL,
	"dataset_id" text,
	"enviado_at" timestamp with time zone,
	"meta_respuesta" jsonb,
	"intentos" bigint DEFAULT 0 NOT NULL,
	"ultimo_error" text,
	"descarte" text,
	"descarte_detalle" jsonb,
	"es_prueba" boolean DEFAULT false NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversiones_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "ontologia"."identidades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"valor" text NOT NULL,
	"fuerza" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontologia"."identidades_bloqueadas" (
	"tipo" text NOT NULL,
	"valor" text NOT NULL,
	"motivo" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontologia"."personas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave_raiz" text,
	"nombre_display" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personas_clave_raiz_unique" UNIQUE("clave_raiz")
);
--> statement-breakpoint
CREATE TABLE "fuentes"."registro" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fuente" text NOT NULL,
	"tabla" text NOT NULL,
	"clave" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ingerido_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ontologia"."vinculos_identidad" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"identidad_id" bigint NOT NULL,
	"persona_id" bigint NOT NULL,
	"regla" text NOT NULL,
	"evidencia" jsonb NOT NULL,
	"actor" text NOT NULL,
	"confianza" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revocado_at" timestamp with time zone,
	"revocado_por" text,
	"revocado_motivo" text
);
--> statement-breakpoint
CREATE TABLE "configuracion" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pauta_serie" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nivel" text NOT NULL,
	"entidad_id" text NOT NULL,
	"cuenta_id" text NOT NULL,
	"fecha" date NOT NULL,
	"gasto" numeric,
	"moneda" text,
	"impresiones" integer,
	"clicks" integer,
	"acciones" jsonb,
	"traido_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pauta_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cuentas" jsonb NOT NULL,
	"rango" text NOT NULL,
	"campanas" jsonb NOT NULL,
	"costo" jsonb,
	"gasto" jsonb,
	"errores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duracion_ms" integer,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sincronizaciones" (
	"fuente" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"ultima_ok" timestamp with time zone,
	"ultimo_error" text,
	"ultimo_error_at" timestamp with time zone,
	"duracion_ms" integer
);
--> statement-breakpoint
CREATE TABLE "webhooks_recibidos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fuente" text NOT NULL,
	"tipo" text,
	"evento_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"estado" text DEFAULT 'recibido' NOT NULL,
	"error" text,
	"recibido_at" timestamp with time zone DEFAULT now() NOT NULL,
	"procesado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rag"."documentos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fuente" text NOT NULL,
	"doc" text NOT NULL,
	"posicion" integer NOT NULL,
	"chunk" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedder" text NOT NULL,
	"sensible" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alias_curso" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"familia" text NOT NULL,
	"nombre_curso" text NOT NULL,
	"ad_id" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alias_curso_alias_uq" UNIQUE("alias"),
	CONSTRAINT "alias_curso_ad_id_uq" UNIQUE("ad_id")
);
--> statement-breakpoint
CREATE TABLE "auto_respuesta_estado" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"encendida" boolean DEFAULT false NOT NULL,
	"motivo" text,
	"actualizado_por" text,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modo" text DEFAULT 'apagada' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_respuestas_pendientes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"canal" text DEFAULT 'whatsapp' NOT NULL,
	"telefono" text NOT NULL,
	"numero_propio" text NOT NULL,
	"persona_nombre" text,
	"plantilla_id" text NOT NULL,
	"texto" text NOT NULL,
	"disparada_por" timestamp with time zone NOT NULL,
	"programado_para" timestamp with time zone NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"motivo" text,
	"dia_lima" text NOT NULL,
	"id_externo" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_at" timestamp with time zone,
	"aprobada_por" text,
	"aprobada_at" timestamp with time zone,
	"editada" boolean DEFAULT false NOT NULL,
	"campana" text,
	"campana_fuente" text,
	CONSTRAINT "auto_respuestas_una_por_dia_uq" UNIQUE("clave","dia_lima")
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"nombre" text NOT NULL,
	"color" text NOT NULL,
	"es_favorito" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categorias_vendedora_id_nombre_unique" UNIQUE("vendedora_id","nombre")
);
--> statement-breakpoint
CREATE TABLE "clientes_padron" (
	"cliente_id" text PRIMARY KEY NOT NULL,
	"sufijo" text NOT NULL,
	"codigo_pais" text,
	"compras" integer DEFAULT 0 NOT NULL,
	"nivel" text NOT NULL,
	"sincronizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversiones_wa" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"telefono" text NOT NULL,
	"nombre" text,
	"cerberus_cliente_id" bigint,
	"origen" jsonb,
	"iniciada_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"para" text NOT NULL,
	"asunto" text NOT NULL,
	"cuerpo" text NOT NULL,
	"clave" text,
	"estado" text NOT NULL,
	"motivo" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "envios_wa" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"numero_propio" text NOT NULL,
	"telefono" text NOT NULL,
	"texto" text NOT NULL,
	"referencia" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"automatico" boolean DEFAULT false NOT NULL,
	"id_externo" text,
	"motivo" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "estado_conversacion" (
	"vendedora_id" text NOT NULL,
	"clave" text NOT NULL,
	"fijada" boolean DEFAULT false NOT NULL,
	"fijada_at" timestamp with time zone,
	"favorita" boolean DEFAULT false NOT NULL,
	"leido_hasta" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estado_conversacion_vendedora_id_clave_pk" PRIMARY KEY("vendedora_id","clave")
);
--> statement-breakpoint
CREATE TABLE "etiquetas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"etiqueta" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etiquetas_clave_etiqueta_unique" UNIQUE("clave","etiqueta")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "events_source_external_id_uq" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "fotos_perfil" (
	"telefono" text PRIMARY KEY NOT NULL,
	"foto_id" text,
	"archivo" text,
	"mime" text,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gestiones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"clave" text NOT NULL,
	"canal" text NOT NULL,
	"persona_id" text,
	"persona_nombre" text,
	"numero_propio" text,
	"etapa" text NOT NULL,
	"proxima_accion" text,
	"proxima_fecha" timestamp with time zone,
	"notas" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hechos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"rotulo" text NOT NULL,
	"texto" text NOT NULL,
	"momentos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"orden" integer DEFAULT 100 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hechos_clave_unique" UNIQUE("clave")
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"external_id" text NOT NULL,
	"canal" text NOT NULL,
	"tipo" text NOT NULL,
	"direccion" text DEFAULT 'entrante' NOT NULL,
	"autor" text DEFAULT 'persona' NOT NULL,
	"persona_id" text,
	"persona_nombre" text,
	"texto" text,
	"page_id" text,
	"contexto_id" text,
	"contexto_texto" text,
	"permalink" text,
	"puede_privado" boolean,
	"puede_privado_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	CONSTRAINT "interactions_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "intereses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"curso" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intereses_clave_curso_unique" UNIQUE("clave","curso")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"lead_id" text NOT NULL,
	"page_id" text,
	"form_id" text,
	"form_name" text,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"platform" text,
	"is_organic" boolean,
	"full_name" text,
	"email" text,
	"phone" text,
	"country" text,
	"custom_fields" jsonb,
	"created_time" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'nuevo' NOT NULL,
	CONSTRAINT "leads_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "notas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clave" text NOT NULL,
	"vendedora_id" text NOT NULL,
	"texto" text NOT NULL,
	"fijada" boolean DEFAULT false NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"editado_at" timestamp with time zone,
	"archivado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "numero_vendedora" (
	"numero" text NOT NULL,
	"vendedora_id" text NOT NULL,
	CONSTRAINT "numero_vendedora_numero_vendedora_id_pk" PRIMARY KEY("numero","vendedora_id")
);
--> statement-breakpoint
CREATE TABLE "numeros_wa" (
	"numero" text PRIMARY KEY NOT NULL,
	"etiqueta" text NOT NULL,
	"proposito" text DEFAULT 'escuela' NOT NULL,
	"referencia" text,
	"activo" boolean DEFAULT true NOT NULL,
	"vinculado_at" timestamp with time zone,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plantilla_pasos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plantilla_id" bigint NOT NULL,
	"orden" integer NOT NULL,
	"texto" text,
	"media_archivo" text,
	"media_mime" text,
	"media_clase" text,
	"media_nombre" text,
	CONSTRAINT "plantilla_pasos_plantilla_id_orden_unique" UNIQUE("plantilla_id","orden")
);
--> statement-breakpoint
CREATE TABLE "plantillas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"nombre" text NOT NULL,
	"familia_curso" text,
	"estado" text DEFAULT 'propuesta' NOT NULL,
	"origen" text DEFAULT 'manual' NOT NULL,
	"respaldo" integer DEFAULT 0 NOT NULL,
	"usos" bigint DEFAULT 0 NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archivado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recordatorios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vendedora_id" text NOT NULL,
	"clave" text NOT NULL,
	"canal" text NOT NULL,
	"persona_id" text,
	"persona_nombre" text,
	"numero_propio" text,
	"nota" text NOT NULL,
	"cuando" timestamp with time zone NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ontologia"."conversiones" ADD CONSTRAINT "conversiones_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "ontologia"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontologia"."vinculos_identidad" ADD CONSTRAINT "vinculos_identidad_identidad_id_identidades_id_fk" FOREIGN KEY ("identidad_id") REFERENCES "ontologia"."identidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ontologia"."vinculos_identidad" ADD CONSTRAINT "vinculos_identidad_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "ontologia"."personas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numero_vendedora" ADD CONSTRAINT "numero_vendedora_numero_numeros_wa_numero_fk" FOREIGN KEY ("numero") REFERENCES "public"."numeros_wa"("numero") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plantilla_pasos" ADD CONSTRAINT "plantilla_pasos_plantilla_id_plantillas_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."plantillas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_persona_idx" ON "ontologia"."cliente" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "cliente_email_idx" ON "ontologia"."cliente" USING btree ("email");--> statement-breakpoint
CREATE INDEX "cuota_venta_idx" ON "ontologia"."cuota" USING btree ("venta_folio");--> statement-breakpoint
CREATE INDEX "detalle_venta_folio_idx" ON "ontologia"."detalle_venta" USING btree ("venta_folio");--> statement-breakpoint
CREATE INDEX "detalle_venta_producto_idx" ON "ontologia"."detalle_venta" USING btree ("producto_codigo");--> statement-breakpoint
CREATE INDEX "pago_venta_idx" ON "ontologia"."pago" USING btree ("venta_folio");--> statement-breakpoint
CREATE INDEX "pago_cuota_idx" ON "ontologia"."pago" USING btree ("cuota_codigo");--> statement-breakpoint
CREATE INDEX "pago_valido_idx" ON "ontologia"."pago" USING btree ("valido");--> statement-breakpoint
CREATE INDEX "venta_cliente_idx" ON "ontologia"."venta" USING btree ("cliente_codigo");--> statement-breakpoint
CREATE INDEX "venta_fecha_idx" ON "ontologia"."venta" USING btree ("fecha_venta");--> statement-breakpoint
CREATE INDEX "venta_cobrada_idx" ON "ontologia"."venta" USING btree ("cobrada");--> statement-breakpoint
CREATE INDEX "venta_pais_idx" ON "ontologia"."venta" USING btree ("pais_cliente");--> statement-breakpoint
CREATE UNIQUE INDEX "hechos_clave_idx" ON "ontologia"."hechos" USING btree ("tipo","clave_natural");--> statement-breakpoint
CREATE INDEX "hechos_sujeto_idx" ON "ontologia"."hechos" USING btree ("sujeto_tipo","sujeto_id","ocurrido_at");--> statement-breakpoint
CREATE INDEX "hechos_tiempo_idx" ON "ontologia"."hechos" USING btree ("ocurrido_at");--> statement-breakpoint
CREATE INDEX "hechos_tipo_idx" ON "ontologia"."hechos" USING btree ("tipo","ocurrido_at");--> statement-breakpoint
CREATE INDEX "conversiones_pendientes_idx" ON "ontologia"."conversiones" USING btree ("enviado_at");--> statement-breakpoint
CREATE INDEX "conversiones_descarte_idx" ON "ontologia"."conversiones" USING btree ("descarte");--> statement-breakpoint
CREATE INDEX "conversiones_persona_idx" ON "ontologia"."conversiones" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identidades_tipo_valor_uq" ON "ontologia"."identidades" USING btree ("tipo","valor");--> statement-breakpoint
CREATE UNIQUE INDEX "identidades_bloqueadas_pk" ON "ontologia"."identidades_bloqueadas" USING btree ("tipo","valor");--> statement-breakpoint
CREATE UNIQUE INDEX "registro_fuente_tabla_clave_uq" ON "fuentes"."registro" USING btree ("fuente","tabla","clave");--> statement-breakpoint
CREATE INDEX "registro_fuente_tabla_idx" ON "fuentes"."registro" USING btree ("fuente","tabla");--> statement-breakpoint
CREATE UNIQUE INDEX "vinculos_identidad_activo_uq" ON "ontologia"."vinculos_identidad" USING btree ("identidad_id") WHERE revocado_at IS NULL;--> statement-breakpoint
CREATE INDEX "vinculos_persona_idx" ON "ontologia"."vinculos_identidad" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pauta_serie_uq" ON "pauta_serie" USING btree ("nivel","entidad_id","fecha");--> statement-breakpoint
CREATE INDEX "pauta_serie_entidad_idx" ON "pauta_serie" USING btree ("nivel","entidad_id","fecha");--> statement-breakpoint
CREATE INDEX "pauta_serie_cuenta_idx" ON "pauta_serie" USING btree ("cuenta_id","fecha");--> statement-breakpoint
CREATE INDEX "pauta_snapshots_reciente_idx" ON "pauta_snapshots" USING btree ("rango","creado_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_fuente_evento_uq" ON "webhooks_recibidos" USING btree ("fuente","evento_id");--> statement-breakpoint
CREATE INDEX "webhooks_pendientes_idx" ON "webhooks_recibidos" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "documentos_doc_pos_idx" ON "rag"."documentos" USING btree ("doc","posicion","embedder");--> statement-breakpoint
CREATE INDEX "documentos_embedding_hnsw" ON "rag"."documentos" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX "documentos_embedder_idx" ON "rag"."documentos" USING btree ("embedder");--> statement-breakpoint
CREATE INDEX "documentos_doc_idx" ON "rag"."documentos" USING btree ("doc");--> statement-breakpoint
CREATE INDEX "alias_curso_familia_idx" ON "alias_curso" USING btree ("familia");--> statement-breakpoint
CREATE INDEX "auto_respuestas_pendientes_idx" ON "auto_respuestas_pendientes" USING btree ("estado","programado_para");--> statement-breakpoint
CREATE INDEX "auto_respuestas_numero_idx" ON "auto_respuestas_pendientes" USING btree ("numero_propio","dia_lima");--> statement-breakpoint
CREATE INDEX "categorias_vendedora_idx" ON "categorias" USING btree ("vendedora_id","orden");--> statement-breakpoint
CREATE INDEX "clientes_padron_sufijo_idx" ON "clientes_padron" USING btree ("sufijo");--> statement-breakpoint
CREATE INDEX "conversiones_wa_vendedora_idx" ON "conversiones_wa" USING btree ("vendedora_id");--> statement-breakpoint
CREATE INDEX "conversiones_wa_telefono_idx" ON "conversiones_wa" USING btree ("telefono");--> statement-breakpoint
CREATE INDEX "correos_vendedora_idx" ON "correos" USING btree ("vendedora_id","creado_at");--> statement-breakpoint
CREATE INDEX "envios_wa_vendedora_idx" ON "envios_wa" USING btree ("vendedora_id");--> statement-breakpoint
CREATE INDEX "envios_wa_telefono_idx" ON "envios_wa" USING btree ("telefono");--> statement-breakpoint
CREATE INDEX "estado_conversacion_pin_idx" ON "estado_conversacion" USING btree ("vendedora_id","fijada");--> statement-breakpoint
CREATE INDEX "estado_conversacion_fav_idx" ON "estado_conversacion" USING btree ("vendedora_id","favorita");--> statement-breakpoint
CREATE INDEX "etiquetas_clave_idx" ON "etiquetas" USING btree ("clave");--> statement-breakpoint
CREATE INDEX "events_occurred_at_idx" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "events_source_idx" ON "events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "gestiones_conversacion_idx" ON "gestiones" USING btree ("clave","creado_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "gestiones_vendedora_idx" ON "gestiones" USING btree ("vendedora_id","creado_at");--> statement-breakpoint
CREATE INDEX "hechos_orden_idx" ON "hechos" USING btree ("activo","orden");--> statement-breakpoint
CREATE INDEX "interactions_occurred_at_idx" ON "interactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "interactions_canal_idx" ON "interactions" USING btree ("canal");--> statement-breakpoint
CREATE INDEX "interactions_status_idx" ON "interactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interactions_persona_idx" ON "interactions" USING btree ("canal","persona_id");--> statement-breakpoint
CREATE INDEX "interactions_ventana_idx" ON "interactions" USING btree ("tipo","occurred_at");--> statement-breakpoint
CREATE INDEX "intereses_clave_idx" ON "intereses" USING btree ("clave");--> statement-breakpoint
CREATE INDEX "leads_created_time_idx" ON "leads" USING btree ("created_time");--> statement-breakpoint
CREATE INDEX "leads_campaign_id_idx" ON "leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "notas_clave_idx" ON "notas" USING btree ("clave","creado_at");--> statement-breakpoint
CREATE INDEX "notas_vendedora_idx" ON "notas" USING btree ("vendedora_id","creado_at");--> statement-breakpoint
CREATE INDEX "numero_vendedora_vendedora_idx" ON "numero_vendedora" USING btree ("vendedora_id");--> statement-breakpoint
CREATE INDEX "plantilla_pasos_idx" ON "plantilla_pasos" USING btree ("plantilla_id","orden");--> statement-breakpoint
CREATE INDEX "plantillas_vendedora_idx" ON "plantillas" USING btree ("vendedora_id","archivado_at");--> statement-breakpoint
CREATE INDEX "recordatorios_agenda_idx" ON "recordatorios" USING btree ("vendedora_id","estado","cuando");--> statement-breakpoint
-- AGREGADO A MANO, igual que la extensión de arriba: drizzle-orm 0.45 no emite índices
-- de expresión en pg-core, así que este GIN se venía creando por SSH después de cada
-- `db:push` (ver el comentario en src/db/schema.ts y docs/deploy-vps1.md). Producción
-- lo tiene; una base recién creada NO lo tenía, y ese era el único drift real entre
-- prod y el schema declarado — lo encontró el diff contra staging.
-- Acá deja de ser un paso manual olvidable y pasa a ser parte de la migración.
-- Sin él, GET /api/notas?q= degrada a seq scan.
CREATE INDEX IF NOT EXISTS "notas_texto_gin_idx" ON "notas" USING gin (to_tsvector('spanish', "texto"));
