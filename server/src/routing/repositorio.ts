import { and, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { campanaAnuncio, campanaRuteo } from "../db/routing.js";
import { leerEstado, ordenarCampanas, type CampanaEnRouting } from "./dominio.js";

/**
 * LO QUE LEE Y ESCRIBE EL RUTEO. El veredicto vive en `dominio.ts` (puro); acá
 * solo se trae el dato crudo y se guarda lo decidido.
 *
 * ⚠️ **Todo degrada, nunca tumba.** Sin las tablas migradas la pantalla muestra
 * cero campañas y lo DICE (`sinMigracion`), y el webhook sigue repartiendo por
 * la rueda. Es lo contrario del catálogo de piezas (ADR 0023) y por el mismo
 * criterio: acá el consumidor es una persona mirando una pantalla, no un índice
 * que cachea.
 */

/** Cuánto para atrás mira la pantalla. La misma ventana que la cola (`ventanaCola`). */
export const VENTANA_DIAS = 30;

/**
 * LOS ANUNCIOS QUE TRAJERON GENTE, crudos, desde el event store.
 *
 * 🔴 Se agrupa por `source_id` y **nunca por el titular**: el mismo anuncio
 * aparece con titulares distintos cuando le cambian el creativo (medido:
 * `120248616484060016` sale como «Inteligencia Estratégica» y como «I Foro de
 * Estado 2026»). Agrupar por titular partiría una campaña en dos.
 *
 * `meta_wa_ctwa` es el único `source` que trae referral: lo escribe
 * `webhook/whatsapp.ts` justo cuando el mensaje viene de un click-to-WhatsApp.
 */
export interface AnuncioVisto {
  adId: string;
  personas: number;
  ultima: string;
}

export async function anunciosVistos(
  base: typeof Base,
  dias = VENTANA_DIAS,
): Promise<AnuncioVisto[]> {
  const filas = await base.execute<{ ad_id: string; personas: number; ultima: string }>(sql`
    SELECT payload->'referral'->>'source_id'        AS ad_id,
           count(DISTINCT payload->>'from')::int    AS personas,
           max(occurred_at)                         AS ultima
      FROM events
     WHERE source = 'meta_wa_ctwa'
       AND occurred_at > now() - ${`${dias} days`}::interval
       AND NULLIF(btrim(payload->'referral'->>'source_id'), '') IS NOT NULL
     GROUP BY 1
  `);
  return filas.map((f) => ({
    adId: f.ad_id,
    // Se cuentan PERSONAS y no mensajes: quien escribe tres veces por el mismo
    // anuncio es un lead, no tres. Con mensajes, la fila premiaría a la campaña
    // que trae gente insistente en vez de a la que trae gente.
    personas: Number(f.personas ?? 0),
    ultima: new Date(f.ultima).toISOString(),
  }));
}

/** El mapa `ad_id → campaña` que ya resolvimos contra Meta. */
export async function mapaDeAnuncios(base: typeof Base) {
  const filas = await base
    .select({
      adId: campanaAnuncio.adId,
      campanaId: campanaAnuncio.campanaId,
      campanaNombre: campanaAnuncio.campanaNombre,
      estado: campanaAnuncio.estado,
      actualizadoAt: campanaAnuncio.actualizadoAt,
    })
    .from(campanaAnuncio);
  return new Map(filas.map((f) => [f.adId, f]));
}

/** Las reglas de una línea: campaña → vendedora. */
export async function reglasDe(base: typeof Base, numeroPropio: string) {
  const filas = await base
    .select({
      campanaId: campanaRuteo.campanaId,
      vendedoraId: campanaRuteo.vendedoraId,
      asignadaPor: campanaRuteo.asignadaPor,
    })
    .from(campanaRuteo)
    .where(eq(campanaRuteo.numeroPropio, numeroPropio));
  return new Map(filas.map((f) => [f.campanaId, f]));
}

export interface FotoDeRouting {
  campanas: CampanaEnRouting[];
  /** Anuncios que trajeron gente y todavía no se resolvieron contra Meta. */
  anunciosSinResolver: number;
  /** Cuándo se le preguntó a Meta por última vez. `null` = nunca. */
  actualizadoAt: string | null;
  /** Sin las tablas migradas la pantalla lo dice en vez de mostrar una lista vacía. */
  sinMigracion: boolean;
}

/**
 * LA FOTO QUE VE LA PANTALLA.
 *
 * ⚠️ **Los anuncios sin resolver se CUENTAN, no se esconden.** Son el único
 * motivo por el que una campaña que está trayendo gente puede no aparecer en la
 * lista, y sin ese número la pantalla afirmaría «estas son todas» sobre una
 * lista incompleta. Es la lección de la galería que mostraba el caso ideal.
 */
export async function fotoDeRouting(
  base: typeof Base,
  numeroPropio: string,
  dias = VENTANA_DIAS,
): Promise<FotoDeRouting> {
  let vistos: AnuncioVisto[];
  let mapa: Awaited<ReturnType<typeof mapaDeAnuncios>>;
  let reglas: Awaited<ReturnType<typeof reglasDe>>;
  try {
    [vistos, mapa, reglas] = await Promise.all([
      anunciosVistos(base, dias),
      mapaDeAnuncios(base),
      reglasDe(base, numeroPropio),
    ]);
  } catch {
    return { campanas: [], anunciosSinResolver: 0, actualizadoAt: null, sinMigracion: true };
  }

  const porCampana = new Map<string, CampanaEnRouting>();
  let sinResolver = 0;
  let ultimoRefresco: Date | null = null;

  for (const v of vistos) {
    const info = mapa.get(v.adId);
    if (!info) {
      sinResolver++;
      continue;
    }
    if (!ultimoRefresco || info.actualizadoAt > ultimoRefresco) ultimoRefresco = info.actualizadoAt;

    const previa = porCampana.get(info.campanaId);
    porCampana.set(info.campanaId, {
      campanaId: info.campanaId,
      nombre: info.campanaNombre,
      estado: leerEstado(info.estado),
      anuncios: (previa?.anuncios ?? 0) + 1,
      personas: (previa?.personas ?? 0) + v.personas,
      ultima:
        previa?.ultima && previa.ultima > v.ultima ? previa.ultima : v.ultima,
      vendedoraId: reglas.get(info.campanaId)?.vendedoraId ?? null,
    });
  }

  return {
    campanas: ordenarCampanas([...porCampana.values()]),
    anunciosSinResolver: sinResolver,
    actualizadoAt: ultimoRefresco?.toISOString() ?? null,
    sinMigracion: false,
  };
}

/** Guarda lo que Meta contestó. Idempotente: reflejar el estado de hoy es el punto. */
export async function guardarAnuncios(
  base: typeof Base,
  filas: readonly { adId: string; campanaId: string; campanaNombre: string; estado: string }[],
): Promise<number> {
  if (filas.length === 0) return 0;
  await base
    .insert(campanaAnuncio)
    .values(filas.map((f) => ({ ...f, actualizadoAt: new Date() })))
    .onConflictDoUpdate({
      target: campanaAnuncio.adId,
      set: {
        campanaId: sql`excluded.campana_id`,
        campanaNombre: sql`excluded.campana_nombre`,
        estado: sql`excluded.estado`,
        actualizadoAt: sql`excluded.actualizado_at`,
      },
    });
  return filas.length;
}

/**
 * Pone (o cambia) la regla de una campaña.
 *
 * ⚠️ **No reasigna nada de lo ya repartido**, a propósito: la regla se aplica en
 * el primer mensaje de cada conversación. Mover conversaciones en curso por
 * cambiar una regla haría que una charla cambie de manos a mitad de camino.
 */
export async function ponerRegla(
  base: typeof Base,
  numeroPropio: string,
  campanaId: string,
  vendedoraId: string,
  quienLaPone: string,
): Promise<void> {
  await base
    .insert(campanaRuteo)
    .values({ numeroPropio, campanaId, vendedoraId, asignadaPor: quienLaPone })
    .onConflictDoUpdate({
      target: [campanaRuteo.numeroPropio, campanaRuteo.campanaId],
      set: { vendedoraId, asignadaPor: quienLaPone, asignadaEn: new Date() },
    });
}

/**
 * Saca la regla: la campaña vuelve a la rueda.
 *
 * **Se BORRA la fila** y no se marca de baja, al revés que `reparto_rueda`. Ahí
 * la baja lógica conserva a quién pertenecían las conversaciones; acá la fila no
 * es de nadie —es una preferencia— y una fila «inactiva» solo daría la duda de
 * si sigue mandando.
 */
export async function sacarRegla(
  base: typeof Base,
  numeroPropio: string,
  campanaId: string,
): Promise<boolean> {
  const filas = await base
    .delete(campanaRuteo)
    .where(and(eq(campanaRuteo.numeroPropio, numeroPropio), eq(campanaRuteo.campanaId, campanaId)))
    .returning({ campanaId: campanaRuteo.campanaId });
  return filas.length > 0;
}

/**
 * A QUIÉN LE CAE ESTE ANUNCIO — la consulta que hace el webhook, en UN viaje.
 *
 * 🔴 **Devuelve `null` ante cualquier duda, y `null` es «que decida la rueda»**
 * (ver `aQuienLeCae` en `dominio.ts`). El `try` es parte del contrato: el
 * reparto no puede tumbar la ingesta de un mensaje.
 */
export async function duenoPorCampana(
  base: typeof Base,
  numeroPropio: string,
  adId: string | null | undefined,
): Promise<string | null> {
  const ad = (adId ?? "").trim();
  if (!ad) return null;
  try {
    const [fila] = await base
      .select({ vendedoraId: campanaRuteo.vendedoraId })
      .from(campanaAnuncio)
      .innerJoin(
        campanaRuteo,
        and(
          eq(campanaRuteo.campanaId, campanaAnuncio.campanaId),
          eq(campanaRuteo.numeroPropio, numeroPropio),
        ),
      )
      .where(eq(campanaAnuncio.adId, ad))
      .limit(1);
    return fila?.vendedoraId ?? null;
  } catch {
    return null;
  }
}
