import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { esCotizacion } from "./cotizacion.js";
import { evaluarEnfriamiento, umbralDeEnv } from "./enfriamiento.js";
import type { SenalConversacion } from "./etiquetasAutomaticas.js";

/**
 * EL SEAM DE SEÑALES — dónde el detector puro se encuentra con la base.
 *
 * Recibe `db` INYECTADO (estilo `consultarCola`/`consultarCategorias`): la ruta
 * le pasa el singleton, el test su base de prueba. Ver ADR 0008.
 *
 * ══ LA DECISIÓN DE DISEÑO QUE IMPORTA ════════════════════════════════════════
 *
 * El criterio de «esto es una cotización» **no se reimplementa en SQL**. El SQL
 * hace solo un PREFILTRO barato y grosero (¿el texto menciona alguna moneda?) y
 * el veredicto lo da la función pura, en TypeScript, sobre los pocos candidatos
 * que sobreviven. Una sola implementación ⇒ nada que pueda divergir.
 *
 * Es exactamente la lección de #37 (ADR 0009): ahí la urgencia estaba escrita
 * dos veces —función pura + proyección SQL— y divergió en silencio; hubo que
 * escribir un test de paridad para atarlas. Acá el problema no existe porque la
 * segunda implementación no existe. El precio es traer unas filas de más a
 * Node; el prefiltro es un SUPERCONJUNTO estricto del detector, así que no
 * puede perder ninguna cotización.
 */

/**
 * El prefiltro: cualquier texto que mencione una moneda. Superconjunto de lo que
 * `RE_MONTO` puede matchear — si esto no matchea, el detector puro tampoco.
 * (Si algún día se agrega una moneda al detector, hay que agregarla ACÁ.)
 */
const PREFILTRO_MONEDA = "(s/|s\\./|\\$|usd|pen|sol|dolar|dólar)";

/**
 * El corroborador: el TEMARIO. La secuencia canónica de venta medida en prod
 * (2026-07-25) es flyer → seguimiento → **temario** → duración; una cifra que
 * llega después de eso está dentro de una venta de verdad. El flyer se detecta
 * por multimedia, que no necesita regex.
 */
const RE_TEMARIO = /temario/i;

export interface OpcionesSenales {
  /** Las conversaciones a evaluar (claves `conv:…` de la cola). */
  claves: string[];
  /** El reloj. Inyectado para poder testear «tres días fría» sin esperar tres días. */
  ahora?: Date;
  /** Días de silencio para el enfriamiento. Default: el del env. */
  umbralDias?: number;
}

interface FilaCandidata {
  clave: string;
  texto: string | null;
  occurred_at: Date;
  con_media: boolean;
  ultimo_entrante_at: Date | null;
}

/** La señal vacía: la forma estable para una conversación sin nada que decir. */
function senalVacia(clave: string, ahora: Date, umbralDias: number): SenalConversacion {
  return {
    clave,
    cotizacion: null,
    corroborada: false,
    enfriamiento: evaluarEnfriamiento({
      cotizadaEn: null,
      ultimoEntranteEn: null,
      ahora,
      umbralDias,
    }),
  };
}

/**
 * Las señales de un puñado de conversaciones, en un mapa por clave. SIEMPRE
 * devuelve una entrada por cada clave pedida (vacía si no hay nada): así el
 * front no tiene que distinguir «sin señal» de «no consultado».
 */
export async function consultarSenales(
  base: typeof db,
  o: OpcionesSenales,
): Promise<Record<string, SenalConversacion>> {
  const ahora = o.ahora ?? new Date();
  const umbralDias = o.umbralDias ?? umbralDeEnv(process.env);

  // Solo las claves de conversación tienen hilo. Un comentario suelto (`int:…`)
  // no se cotiza ni se enfría: se responde o no.
  const claves = [...new Set(o.claves.filter((c) => c.startsWith("conv:")))];
  const salida: Record<string, SenalConversacion> = {};
  for (const c of o.claves) salida[c] = senalVacia(c, ahora, umbralDias);
  if (claves.length === 0) return salida;

  const lista = sql.join(
    claves.map((c) => sql`${c}`),
    sql`, `,
  );

  const filas = (await base.execute(sql`
    WITH msg AS (
      SELECT 'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '') AS clave,
             i.direccion,
             i.texto,
             i.occurred_at,
             (e.payload->'media' IS NOT NULL AND e.payload->>'media' <> 'null') AS con_media
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.occurred_at > now() - interval '90 days'
        AND ('conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '')) IN (${lista})
    ),
    entrantes AS (
      SELECT clave, max(occurred_at) AS ultimo_entrante_at
      FROM msg WHERE direccion = 'entrante' GROUP BY clave
    ),
    candidatos AS (
      SELECT clave, texto, occurred_at, con_media
      FROM msg
      WHERE direccion = 'saliente'
        AND (con_media OR texto ~* ${PREFILTRO_MONEDA} OR texto ~* 'temario')
    )
    SELECT c.clave, c.texto, c.occurred_at, c.con_media, e.ultimo_entrante_at
    FROM candidatos c
    LEFT JOIN entrantes e USING (clave)
    ORDER BY c.clave, c.occurred_at
  `)) as unknown as FilaCandidata[];

  const porClave = new Map<string, FilaCandidata[]>();
  for (const f of filas) {
    const lote = porClave.get(f.clave);
    if (lote) lote.push(f);
    else porClave.set(f.clave, [f]);
  }

  for (const [clave, candidatos] of porClave) {
    // La cotización que cuenta es la ÚLTIMA: si mandó el precio dos veces, el
    // enfriamiento se mide desde el segundo, no desde el primero.
    let iCotiza = -1;
    let veredicto: ReturnType<typeof esCotizacion> | null = null;
    for (let i = 0; i < candidatos.length; i++) {
      const v = esCotizacion(candidatos[i].texto);
      if (v.esCotizacion) {
        iCotiza = i;
        veredicto = v;
      }
    }

    const cotizadaEn = iCotiza >= 0 ? new Date(candidatos[iCotiza].occurred_at) : null;

    // Corroboración: ¿hubo flyer (multimedia) o temario ANTES de la cifra?
    const corroborada =
      iCotiza >= 0 &&
      candidatos.some(
        (c, i) => i !== iCotiza && (c.con_media || RE_TEMARIO.test(c.texto ?? "")),
      );

    const ultimoEntranteEn = candidatos[0].ultimo_entrante_at
      ? new Date(candidatos[0].ultimo_entrante_at)
      : null;

    salida[clave] = {
      clave,
      cotizacion:
        veredicto && cotizadaEn ? { ...veredicto, ocurridoEn: cotizadaEn.toISOString() } : null,
      corroborada,
      enfriamiento: evaluarEnfriamiento({ cotizadaEn, ultimoEntranteEn, ahora, umbralDias }),
    };
  }

  return salida;
}
