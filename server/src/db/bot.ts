import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const botEstado = pgTable("bot_estado", {
  numeroPropio: text("numero_propio").primaryKey(),
  modo: text("modo").notNull().default("apagado"),
  frenadoMotivo: text("frenado_motivo"),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoPor: text("actualizado_por"),
});

export const botPendientes = pgTable(
  "bot_pendientes",
  {
    clave: text("clave").primaryKey(),
    numeroPropio: text("numero_propio").notNull(),
    ultimoEntranteEn: timestamp("ultimo_entrante_en", { withTimezone: true }).notNull(),
    procesarDesde: timestamp("procesar_desde", { withTimezone: true }).notNull(),
    enProcesoDesde: timestamp("en_proceso_desde", { withTimezone: true }),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bot_pendientes_turno_idx").on(t.procesarDesde, t.enProcesoDesde),
  ],
);

export const botRespuestas = pgTable(
  "bot_respuestas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    clave: text("clave").notNull(),
    numeroPropio: text("numero_propio").notNull(),
    texto: text("texto"),
    textoCompleto: text("texto_completo"),
    acciones: jsonb("acciones").notNull().default([]),
    estado: text("estado").notNull(),
    motivo: text("motivo"),
    modelo: text("modelo"),
    tokensEntrada: integer("tokens_entrada"),
    tokensSalida: integer("tokens_salida"),
    tokensCacheEscritura: integer("tokens_cache_escritura"),
    tokensCacheLectura: integer("tokens_cache_lectura"),
    revision: text("revision"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bot_respuestas_estado_idx").on(t.estado, t.creadoEn),
    index("bot_respuestas_clave_idx").on(t.clave),
  ],
);

export const botPausas = pgTable("bot_pausas", {
  clave: text("clave").primaryKey(),
  motivo: text("motivo").notNull(),
  hasta: timestamp("hasta", { withTimezone: true }),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const botCalificaciones = pgTable("bot_calificaciones", {
  clave: text("clave").primaryKey(),
  temperatura: text("temperatura"),
  motivo: text("motivo"),
  escalada: boolean("escalada").notNull().default(false),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const botEstadoConversacion = pgTable(
  "bot_estado_conversacion",
  {
    clave: text("clave").primaryKey(),
    estado: text("estado").notNull().default("desconocido"),
    datos: jsonb("datos").notNull().default({}),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bot_estado_conv_estado_idx").on(t.estado, t.actualizadoEn),
  ],
);

export const botMemoriaLead = pgTable(
  "bot_memoria_lead",
  {
    clave: text("clave").primaryKey(),
    hechos: jsonb("hechos").notNull().default({}),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
);
