import { randomUUID } from "node:crypto";
import {
  conversionesWa,
  enviosWa,
  estadoConversacion,
  etiquetas,
  events,
  gestiones,
  interactions,
  intereses,
  leads,
  notas,
  recordatorios,
} from "../db/schema.js";
import { sincronizarLote } from "../clientes/sincronizar.js";
import { A_MANO, columnasDeProcedencia, type Procedencia } from "../procedencia/pieza.js";
import type { DbDePrueba } from "./base.js";

/**
 * SIEMBRA para los tests con base. Cada helper inserta lo MÍNIMO para que una
 * consulta tenga algo que devolver, con defaults sensatos que el test
 * sobreescribe solo cuando le importa. Nada de fixtures gigantes: el test dice
 * qué hecho está probando y el resto es ruido.
 *
 * Empieza chico (mensaje + recordatorio, lo que necesita el primer test de la
 * cola/radar). Crece cuando un test nuevo lo pida — no antes.
 */

export interface MensajeSembrado {
  canal?: string;
  /** 'mensaje' (default) | 'comentario' — mismo helper, la tabla es una sola. */
  tipo?: "mensaje" | "comentario";
  personaId?: string;
  personaNombre?: string | null;
  texto?: string | null;
  direccion?: "entrante" | "saliente";
  /** El número propio del que sale el hilo — la cola agrupa por él. */
  numeroPropio?: string;
  /** La clase de media (imagen/video/audio/documento/sticker), en el payload del evento. */
  mediaClase?: string;
  /** El origen del lead (anuncio/landing), en el payload del evento — como lo guarda proyectar. */
  origen?: { fuente: string; titulo?: string | null; adId?: string; ref?: string } | null;
  occurredAt?: Date;
}

/**
 * Siembra un mensaje (o comentario): el evento crudo (fuente de verdad) + la
 * interacción proyectada. El `numeroPropio` va en el payload del evento, que
 * es de donde la cola y el radar lo sacan (`payload->>'numeroPropio'`).
 * Devuelve el id de la interacción.
 */
export async function sembrarMensaje(db: DbDePrueba, m: MensajeSembrado = {}): Promise<number> {
  const occurredAt = m.occurredAt ?? new Date();
  const numeroPropio = m.numeroPropio ?? "51999999999";
  const ext = randomUUID();

  const [ev] = await db
    .insert(events)
    .values({
      source: "whatsapp",
      externalId: `evt:${ext}`,
      occurredAt,
      payload: {
        numeroPropio,
        ...(m.mediaClase ? { media: { clase: m.mediaClase } } : {}),
        ...(m.origen !== undefined ? { origen: m.origen } : {}),
      },
    })
    .returning({ id: events.id });

  const [it] = await db
    .insert(interactions)
    .values({
      eventId: ev.id,
      externalId: `wa:${ext}`,
      canal: m.canal ?? "whatsapp",
      tipo: m.tipo ?? "mensaje",
      direccion: m.direccion ?? "entrante",
      personaId: m.personaId ?? "51900000000",
      personaNombre: m.personaNombre ?? "Lead de prueba",
      texto: m.texto ?? null,
      occurredAt,
    })
    .returning({ id: interactions.id });

  return it.id;
}

export interface ComentarioSembrado {
  canal?: string;
  personaId?: string;
  personaNombre?: string | null;
  texto?: string | null;
  /** 'nuevo' = sin responder. Cualquier otro estado cuenta como respondido para la cola. */
  status?: string;
  occurredAt?: Date;
}

/**
 * Siembra un comentario de FB/IG: el evento crudo + la interacción proyectada.
 * A diferencia de los mensajes, un comentario es UNA fila de la cola (no se
 * agrupa) y su ventana de Meta se deriva de `occurred_at` (7 días).
 */
export async function sembrarComentario(db: DbDePrueba, c: ComentarioSembrado = {}): Promise<number> {
  const occurredAt = c.occurredAt ?? new Date();
  const ext = randomUUID();

  const [ev] = await db
    .insert(events)
    .values({
      source: c.canal ?? "facebook",
      externalId: `evt:${ext}`,
      occurredAt,
      payload: {},
    })
    .returning({ id: events.id });

  const [it] = await db
    .insert(interactions)
    .values({
      eventId: ev.id,
      externalId: `com:${ext}`,
      canal: c.canal ?? "facebook",
      tipo: "comentario",
      direccion: "entrante",
      personaId: c.personaId ?? "fb-persona",
      personaNombre: c.personaNombre ?? "Comentarista de prueba",
      texto: c.texto ?? "¿precio?",
      occurredAt,
      ...(c.status ? { status: c.status } : {}),
    })
    .returning({ id: interactions.id });

  return it.id;
}

export interface LeadSembrado {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  platform?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  formName?: string | null;
  createdTime?: Date;
}

/**
 * Siembra un lead de formulario (Lead Ads / landing): el evento crudo + la
 * proyección en `leads`. Devuelve el `leadId` (el externo, no el serial).
 */
export async function sembrarLead(db: DbDePrueba, l: LeadSembrado = {}): Promise<string> {
  const createdTime = l.createdTime ?? new Date();
  const ext = randomUUID();

  const [ev] = await db
    .insert(events)
    .values({
      source: "meta_lead_ad",
      externalId: `evt:${ext}`,
      occurredAt: createdTime,
      payload: {},
    })
    .returning({ id: events.id });

  const leadId = `lead:${ext}`;
  await db.insert(leads).values({
    eventId: ev.id,
    leadId,
    fullName: l.fullName ?? "Lead de prueba",
    email: l.email ?? null,
    phone: l.phone ?? null,
    platform: l.platform ?? "fb",
    campaignName: l.campaignName ?? null,
    adName: l.adName ?? null,
    formName: l.formName ?? null,
    createdTime,
  });

  return leadId;
}

export interface EnvioWaSembrado {
  vendedoraId?: string;
  telefono?: string;
  numeroPropio?: string;
  /** La conversación. Por defecto se deriva de teléfono + número propio. */
  referencia?: string;
  texto?: string;
  estado?: "pendiente" | "enviado" | "fallido";
  creadoAt?: Date;
  /** Cuándo salió de verdad. Sin esto, el alta (`creadoAt`). */
  resueltoAt?: Date | null;
  /**
   * De qué pieza salió (#169). Se arma con los constructores de
   * `procedencia/pieza.ts` — omitirla es sembrar la línea de base, que es lo
   * que corresponde para un envío escrito a mano.
   */
  procedencia?: Procedencia;
}

/** Siembra un envío de WhatsApp (la auditoría de `EnvioControlado`). */
export async function sembrarEnvioWa(db: DbDePrueba, e: EnvioWaSembrado = {}): Promise<number> {
  const telefono = e.telefono ?? "51900000000";
  const numeroPropio = e.numeroPropio ?? "51999999999";
  const creadoAt = e.creadoAt ?? new Date();

  const [row] = await db
    .insert(enviosWa)
    .values({
      vendedoraId: e.vendedoraId ?? "vendedora-prueba",
      numeroPropio,
      telefono,
      texto: e.texto ?? "hola",
      referencia: e.referencia ?? `conv:whatsapp:${telefono}:${numeroPropio}`,
      estado: e.estado ?? "enviado",
      creadoAt,
      resueltoAt: e.resueltoAt === undefined ? creadoAt : e.resueltoAt,
      ...columnasDeProcedencia(e.procedencia ?? A_MANO),
    })
    .returning({ id: enviosWa.id });

  return row.id;
}

export interface ConversionWaSembrada {
  vendedoraId?: string;
  telefono?: string;
  iniciadaAt?: Date;
}

/** Siembra una conversión de WhatsApp (un lead que se volvió venta). */
export async function sembrarConversionWa(db: DbDePrueba, v: ConversionWaSembrada = {}): Promise<number> {
  const [row] = await db
    .insert(conversionesWa)
    .values({
      vendedoraId: v.vendedoraId ?? "vendedora-prueba",
      telefono: v.telefono ?? "51900000000",
      iniciadaAt: v.iniciadaAt ?? new Date(),
    })
    .returning({ id: conversionesWa.id });

  return row.id;
}

/**
 * Siembra un curso de interés — lo que la COMPUERTA 1 de las gestiones exige
 * para dejar pasar a Cotizado (issue #60). Con `creadoAt` explícito se controla
 * el orden que la línea de tiempo tiene que respetar (#57); sin él, `defaultNow()`.
 */
export async function sembrarInteres(
  db: DbDePrueba,
  i: { clave: string; curso?: string; vendedoraId?: string; creadoAt?: Date },
): Promise<void> {
  await db.insert(intereses).values({
    clave: i.clave,
    curso: i.curso ?? "Curso de prueba",
    vendedoraId: i.vendedoraId ?? "vendedora-prueba",
    ...(i.creadoAt ? { creadoAt: i.creadoAt } : {}),
  });
}

export interface RecordatorioSembrado {
  vendedoraId?: string;
  clave: string;
  canal?: string;
  personaId?: string;
  personaNombre?: string | null;
  numeroPropio?: string | null;
  nota?: string;
  /** La fecha del seguimiento. Una fecha pasada = un Vencido. */
  cuando: Date;
  estado?: "pendiente" | "hecho";
}

/**
 * Siembra un seguimiento agendado (la promesa que la vendedora se pone a sí
 * misma). Con `cuando` en el pasado y `estado: 'pendiente'` es un Vencido — lo
 * que el radar tiene que subir al nivel 1 (issue #38).
 */
export async function sembrarRecordatorio(db: DbDePrueba, r: RecordatorioSembrado): Promise<number> {
  const [rec] = await db
    .insert(recordatorios)
    .values({
      vendedoraId: r.vendedoraId ?? "vendedora-prueba",
      clave: r.clave,
      canal: r.canal ?? "whatsapp",
      personaId: r.personaId ?? "51900000000",
      personaNombre: r.personaNombre ?? "Lead de prueba",
      numeroPropio: r.numeroPropio ?? "51999999999",
      nota: r.nota ?? "llamar",
      cuando: r.cuando,
      estado: r.estado ?? "pendiente",
    })
    .returning({ id: recordatorios.id });

  return rec.id;
}

export interface EtiquetaSembrada {
  /** La conversación etiquetada (clave de la cola). */
  clave: string;
  /** El string de la etiqueta — se guarda en minúsculas, como el POST real. */
  etiqueta: string;
  /** Quién la puso. La asignación es compartida por el equipo; el backfill agrupa por acá. */
  vendedoraId?: string;
}

/**
 * Siembra una ASIGNACIÓN de etiqueta (la tabla compartida `etiquetas`). Sirve
 * para probar el conteo por categoría y el backfill de categorías (#48).
 */
export async function sembrarEtiqueta(db: DbDePrueba, e: EtiquetaSembrada): Promise<void> {
  await db.insert(etiquetas).values({
    clave: e.clave,
    etiqueta: e.etiqueta.toLowerCase(),
    vendedoraId: e.vendedoraId ?? "vendedora-prueba",
  });
}

export interface NotaSembrada {
  clave?: string;
  vendedoraId?: string;
  texto?: string;
  fijada?: boolean;
  archivadoAt?: Date | null;
}

/** Siembra una nota (#47). Por defecto viva, sin fijar, en la libreta 'general'. */
export async function sembrarNota(db: DbDePrueba, n: NotaSembrada = {}): Promise<number> {
  const [fila] = await db
    .insert(notas)
    .values({
      clave: n.clave ?? "general",
      vendedoraId: n.vendedoraId ?? "vendedora-prueba",
      texto: n.texto ?? "nota de prueba",
      fijada: n.fijada ?? false,
      archivadoAt: n.archivadoAt ?? null,
    })
    .returning({ id: notas.id });

  return fila.id;
}

export interface EstadoConversacionSembrado {
  vendedoraId?: string;
  clave: string;
  fijada?: boolean;
  fijadaAt?: Date | null;
  favorita?: boolean;
  /** El cursor de lectura. Con una fecha ANTES del último entrante → sigue «sin leer». */
  leidoHasta?: Date | null;
}

/**
 * Siembra el estado personal de una conversación (`estado_conversacion`, #49) —
 * para los tests de pin/favorita/no_leído de la cola potenciada. Inserta directo
 * (fixture), no vía el seam `upsertEstado`, para poder fijar `leido_hasta` a una
 * fecha exacta relativa a los mensajes sembrados.
 */
export async function sembrarEstadoConversacion(
  db: DbDePrueba,
  e: EstadoConversacionSembrado,
): Promise<void> {
  await db.insert(estadoConversacion).values({
    vendedoraId: e.vendedoraId ?? "vendedora-prueba",
    clave: e.clave,
    fijada: e.fijada ?? false,
    fijadaAt: e.fijadaAt ?? (e.fijada ? new Date() : null),
    favorita: e.favorita ?? false,
    leidoHasta: e.leidoHasta ?? null,
  });
}

export interface GestionSembrada {
  clave: string;
  vendedoraId?: string;
  canal?: string;
  etapa?: string;
  /** El texto del viejo textarea «Notas de acuerdos» — null/omitido = sin nota en esa gestión. */
  notas?: string | null;
  creadoAt?: Date;
}

/**
 * Siembra una GESTIÓN (la bitácora comercial, append-only) — para los tests de
 * `listarNotas` que mezclan lo editable con lo histórico de `gestiones.notas`
 * (#47, ver ADR 0012). No usa el seam de gestiones (no lo necesita: es solo
 * fixture) — inserta directo, como el resto de `sembrar.ts`.
 */
export interface ClienteSembrado {
  /** El teléfono tal como lo guarda el padrón: internacional o local. */
  telefono: string;
  /** El país declarado — lo que permite completar un número local a E.164. */
  pais?: string | null;
  compras?: number;
  /** El `buyer_tier` crudo del padrón (`vip` · `repeat` · `single` · `prospect`). */
  tier?: string | null;
  id?: string | number;
}

/**
 * Siembra un cliente del PADRÓN (#133). A diferencia del resto de `sembrar.ts`,
 * NO inserta a mano: pasa por `sincronizarLote`, que es el camino real por el
 * que la fila llega a `clientes_padron`. Así el test del cruce prueba también
 * cómo se guardó — que es donde vive la normalización a E.164 y el código de
 * país que evita el falso positivo de #119.
 */
export async function sembrarCliente(db: DbDePrueba, c: ClienteSembrado): Promise<void> {
  await sincronizarLote(db, [
    {
      id: c.id ?? randomUUID(),
      phone: c.telefono,
      country: c.pais ?? null,
      n_purchases: c.compras ?? 1,
      buyer_tier: c.tier ?? null,
    },
  ]);
}

export async function sembrarGestion(db: DbDePrueba, g: GestionSembrada): Promise<number> {
  const [fila] = await db
    .insert(gestiones)
    .values({
      vendedoraId: g.vendedoraId ?? "vendedora-prueba",
      clave: g.clave,
      canal: g.canal ?? "whatsapp",
      etapa: g.etapa ?? "interesado",
      notas: g.notas ?? null,
      creadoAt: g.creadoAt ?? new Date(),
    })
    .returning({ id: gestiones.id });

  return fila.id;
}
