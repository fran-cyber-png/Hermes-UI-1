import { and, eq, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { campanaAnuncio, campanaMeta, campanaRuteo } from "../db/routing.js";
import { leerEstado, llegaALaLinea, ordenarCampanas, type CampanaEnRouting } from "./dominio.js";

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

/**
 * LOS CABLES DE UNA LÍNEA: campaña → el conjunto de vendedoras conectadas.
 *
 * Devuelve el conjunto ORDENADO. El orden no decide a quién le toca —eso lo hace
 * la carga— pero sí que dos aperturas de la pantalla dibujen los mismos cables
 * en el mismo lugar.
 */
export async function cablesDe(base: typeof Base, numeroPropio: string) {
  const filas = await base
    .select({ campanaId: campanaRuteo.campanaId, vendedoraId: campanaRuteo.vendedoraId })
    .from(campanaRuteo)
    .where(eq(campanaRuteo.numeroPropio, numeroPropio));

  const por = new Map<string, string[]>();
  for (const f of filas) por.set(f.campanaId, [...(por.get(f.campanaId) ?? []), f.vendedoraId]);
  for (const [k, v] of por) por.set(k, v.sort((a, b) => a.localeCompare(b, "es")));
  return por;
}

/** El catálogo de campañas que Meta conoce, con los números a los que mandan. */
export async function campanasConocidas(base: typeof Base) {
  return base
    .select({
      campanaId: campanaMeta.campanaId,
      nombre: campanaMeta.nombre,
      estado: campanaMeta.estado,
      numeros: campanaMeta.numeros,
      actualizadoAt: campanaMeta.actualizadoAt,
    })
    .from(campanaMeta);
}

export interface FotoDeRouting {
  campanas: CampanaEnRouting[];
  /** Anuncios que trajeron gente y todavía no se resolvieron contra Meta. */
  anunciosSinResolver: number;
  /**
   * Campañas de la cuenta que mandan a WhatsApp pero **no a esta línea**. No se
   * listan —no se pueden rutear— pero se CUENTAN: sin este número la pantalla
   * afirmaría «estas son todas las campañas» sobre una cuenta donde, medido el
   * 12-ago-2026, dieciséis de diecisiete adsets activos mandan a otro lado.
   */
  campanasEnOtraLinea: number;
  /** Cuándo se le preguntó a Meta por última vez. `null` = nunca. */
  actualizadoAt: string | null;
  /** Sin las tablas migradas la pantalla lo dice en vez de mostrar una lista vacía. */
  sinMigracion: boolean;
}

/**
 * LA FOTO QUE VE LA PANTALLA.
 *
 * 🔴 **La lista sale del catálogo de META, no de `events`.** El primer borrador
 * la derivaba de los click-to-WhatsApp recibidos, y eso deja afuera justo el caso
 * que importa: una campaña estrenada hoy, que es cuando querés dejar el cable
 * puesto ANTES del primer lead. El volumen observado se suma como dato de la
 * fila, no como condición para existir.
 *
 * 🔴 **Y se recorta a las que mandan a ESTA línea** (`llegaALaLinea`). Ofrecer un
 * cable sobre una campaña que apunta a otro teléfono sería ofrecer un cable que
 * no puede llevar nada: el lead entra por un número que este server no atiende.
 */
export async function fotoDeRouting(
  base: typeof Base,
  numeroPropio: string,
  dias = VENTANA_DIAS,
): Promise<FotoDeRouting> {
  let vistos: AnuncioVisto[];
  let mapa: Awaited<ReturnType<typeof mapaDeAnuncios>>;
  let cables: Awaited<ReturnType<typeof cablesDe>>;
  let catalogo: Awaited<ReturnType<typeof campanasConocidas>>;
  try {
    [vistos, mapa, cables, catalogo] = await Promise.all([
      anunciosVistos(base, dias),
      mapaDeAnuncios(base),
      cablesDe(base, numeroPropio),
      campanasConocidas(base),
    ]);
  } catch {
    return {
      campanas: [],
      anunciosSinResolver: 0,
      campanasEnOtraLinea: 0,
      actualizadoAt: null,
      sinMigracion: true,
    };
  }

  // El volumen observado, por campaña. Un anuncio sin resolver no suma a ninguna.
  const volumen = new Map<string, { anuncios: number; personas: number; ultima: string }>();
  let sinResolver = 0;
  for (const v of vistos) {
    const campanaId = mapa.get(v.adId)?.campanaId;
    if (!campanaId) {
      sinResolver++;
      continue;
    }
    const previa = volumen.get(campanaId);
    volumen.set(campanaId, {
      anuncios: (previa?.anuncios ?? 0) + 1,
      personas: (previa?.personas ?? 0) + v.personas,
      ultima: previa?.ultima && previa.ultima > v.ultima ? previa.ultima : v.ultima,
    });
  }

  let ultimoRefresco: Date | null = null;
  let enOtraLinea = 0;
  const campanas: CampanaEnRouting[] = [];
  for (const c of catalogo) {
    if (!ultimoRefresco || c.actualizadoAt > ultimoRefresco) ultimoRefresco = c.actualizadoAt;
    if (!llegaALaLinea(c.numeros, numeroPropio)) {
      // Solo cuentan las que mandan a ALGÚN WhatsApp: una campaña de tráfico web
      // no es «de otra línea», simplemente no es de este frente.
      if (c.numeros.length > 0) enOtraLinea++;
      continue;
    }
    const v = volumen.get(c.campanaId);
    campanas.push({
      campanaId: c.campanaId,
      nombre: c.nombre,
      estado: leerEstado(c.estado),
      anuncios: v?.anuncios ?? 0,
      personas: v?.personas ?? 0,
      ultima: v?.ultima ?? null,
      vendedoras: cables.get(c.campanaId) ?? [],
    });
  }

  return {
    campanas: ordenarCampanas(campanas),
    anunciosSinResolver: sinResolver,
    campanasEnOtraLinea: enOtraLinea,
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
 * DEJA LOS CABLES DE UNA CAMPAÑA EXACTAMENTE COMO SE PIDIÓ.
 *
 * 🔴 **Es declarativo y reemplaza el conjunto entero**, no un `connect`/`disconnect`
 * por cable. Con operaciones incrementales, dos personas editando la misma
 * campaña se pisan y ninguna se entera: la última en apretar cree que sumó un
 * cable y en realidad borró el de la otra. Mandando el conjunto completo, lo que
 * quedó guardado es lo que la pantalla mostraba.
 *
 * ⚠️ **Borra y reinserta adentro de UNA transacción.** Sin ella, una caída entre
 * el DELETE y el INSERT deja la campaña sin ningún cable —o sea, repartiendo por
 * la rueda general— que es un estado que nadie pidió.
 *
 * Lista vacía = se cortan todos los cables y la campaña vuelve a la rueda.
 */
export async function ponerCables(
  base: typeof Base,
  numeroPropio: string,
  campanaId: string,
  vendedoras: readonly string[],
  quienLosPone: string,
): Promise<void> {
  const unicas = [...new Set(vendedoras.map((v) => v.trim()).filter(Boolean))];
  await base.transaction(async (tx) => {
    await tx
      .delete(campanaRuteo)
      .where(
        and(eq(campanaRuteo.numeroPropio, numeroPropio), eq(campanaRuteo.campanaId, campanaId)),
      );
    if (unicas.length === 0) return;
    await tx.insert(campanaRuteo).values(
      unicas.map((vendedoraId) => ({
        numeroPropio,
        campanaId,
        vendedoraId,
        asignadaPor: quienLosPone,
      })),
    );
  });
}

/**
 * A QUIÉNES LES PUEDE CAER ESTE ANUNCIO — la consulta que hace el webhook.
 *
 * 🔴 **Vacío ante cualquier duda, y vacío es «que decida la rueda»**. El `try` es
 * parte del contrato: el reparto no puede tumbar la ingesta de un mensaje.
 */
export async function duenosPorCampana(
  base: typeof Base,
  numeroPropio: string,
  adId: string | null | undefined,
): Promise<string[]> {
  const ad = (adId ?? "").trim();
  if (!ad) return [];
  try {
    const filas = await base
      .select({ vendedoraId: campanaRuteo.vendedoraId })
      .from(campanaAnuncio)
      .innerJoin(
        campanaRuteo,
        and(
          eq(campanaRuteo.campanaId, campanaAnuncio.campanaId),
          eq(campanaRuteo.numeroPropio, numeroPropio),
        ),
      )
      .where(eq(campanaAnuncio.adId, ad));
    return filas.map((f) => f.vendedoraId).sort((a, b) => a.localeCompare(b, "es"));
  } catch {
    return [];
  }
}

/** Guarda el catálogo de campañas que contestó Meta. Idempotente: refleja el hoy. */
export async function guardarCampanas(
  base: typeof Base,
  filas: readonly { campanaId: string; nombre: string; estado: string; numeros: string[] }[],
): Promise<number> {
  if (filas.length === 0) return 0;
  await base
    .insert(campanaMeta)
    .values(filas.map((f) => ({ ...f, actualizadoAt: new Date() })))
    .onConflictDoUpdate({
      target: campanaMeta.campanaId,
      set: {
        nombre: sql`excluded.nombre`,
        estado: sql`excluded.estado`,
        numeros: sql`excluded.numeros`,
        actualizadoAt: sql`excluded.actualizado_at`,
      },
    });
  return filas.length;
}
