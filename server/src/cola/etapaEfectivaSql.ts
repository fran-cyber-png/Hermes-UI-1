import { sql, type SQL } from "drizzle-orm";
import { ETAPAS, normalizarEtapa } from "../gestiones/registrarGestion.js";

/**
 * LA ETAPA EFECTIVA — la política del embudo, dicha UNA vez (#88, ADR 0013).
 *
 * Hasta acá la etapa de una conversación se decidía en tres lugares con
 * criterios distintos: el front caía al fallback 'interesado' para todo lo que
 * no tenía gestión, el dashboard contaba la historia entera de `gestiones` sin
 * ventana, y la señal `respondida` — que ya viaja en cada fila de la cola — no
 * influía en nada. Resultado: 1129 conversaciones ya respondidas apiladas en
 * «Interesados» como si nadie las hubiera trabajado.
 *
 * La regla del dueño (2026-07-24, épica #87), con su precedencia:
 *
 *   · DERIVADA  = respondida ? 'contactado' : 'interesado'. Es un PISO: si ya
 *     le respondimos, esa persona está contactada — nadie tiene que arrastrarla.
 *   · MANUAL    = la etapa de la ÚLTIMA gestión asentada por clave (o ninguna).
 *   · EFECTIVA  = sin manual → derivada;
 *                 manual = perdido → PERDIDO (terminal humano: la clasificación
 *                 de la vendedora gana siempre; nada lo resucita solo);
 *                 si no → max(manual, derivada) en la escala
 *                 interesado < contactado < cotizado < cierre.
 *     La derivación solo empuja hacia ARRIBA: una manual más avanzada gana, y
 *     una manual más atrás que el piso no baja la conversación.
 *
 * MISMO PATRÓN QUE LA URGENCIA (`urgenciaSql.ts`, ADR 0009): la cola pagina en
 * la base, así que la regla tiene que poder decirse en SQL — pero la definición
 * canónica es UNA. Acá viven la función pura (`etapaEfectiva`) y su proyección
 * SQL (`etapaEfectivaSql`), lado a lado, compartiendo la escala; el test de
 * paridad (`etapaEfectiva.paridad.test.db.ts`) corre las dos contra los mismos
 * datos y falla en CI si dicen cosas distintas. Si tocás la regla acá, tocás
 * las dos formas en el mismo commit — el test es el candado. NO se replica en
 * JS del front ni en otra consulta: espejos mantenidos a mano es exactamente la
 * clase de bug que ya sangró una vez (#37).
 *
 * CONTRATO DE COLUMNAS (como `urgenciaSql.ts`): el fragmento nombra las
 * columnas tal como las alias la consulta que lo consume —
 *   respondida (bool) · etapa_manual (text, NULL si no hay gestión asentada).
 * `etapa_manual` sale de `ultimasGestionesSql` (LEFT JOIN por clave).
 */

/**
 * La escala que sube: interesado(0) < contactado(1) < cotizado(2) < cierre(3).
 * Sale de ETAPAS (la lista canónica de `gestiones/registrarGestion.ts`) para no
 * duplicar el orden; `perdido` queda afuera a propósito — no es un peldaño, es
 * la salida terminal.
 */
export const ESCALA_ETAPAS: readonly string[] = ETAPAS.filter((e) => e !== "perdido");

/**
 * LA FUNCIÓN PURA — la definición canónica de la regla. La comparten los tests
 * de paridad y cualquier lector de TypeScript que necesite la etapa efectiva.
 */
export function etapaEfectiva(etapaManual: string | null, respondida: boolean): string {
  const derivada = respondida ? "contactado" : "interesado";
  if (etapaManual == null) return derivada;
  const manual = normalizarEtapa(etapaManual);
  if (manual === "perdido") return "perdido";
  // Una manual fuera de la escala (dato viejo o basura) rankea -1: manda el piso.
  return ESCALA_ETAPAS.indexOf(manual) >= ESCALA_ETAPAS.indexOf(derivada) ? manual : derivada;
}

// ── La MISMA regla, dicha en SQL ─────────────────────────────────────────────

/** El rango de una etapa en la escala, generado DESDE la constante compartida. */
const rango = (etapa: SQL): SQL =>
  sql`(CASE ${etapa} ${sql.join(
    ESCALA_ETAPAS.map((e, i) => sql`WHEN ${e} THEN ${i}`),
    sql` `,
  )} ELSE -1 END)`;

/** El piso derivado: le respondimos → contactado; si no → interesado. */
const DERIVADA = sql`(CASE WHEN respondida THEN 'contactado' ELSE 'interesado' END)`;

/**
 * `etapa_manual` normalizada al leer — espejo SQL de `normalizarEtapa`
 * (`gestiones/registrarGestion.ts`): los valores viejos siguen siendo válidos.
 * La paridad con la función de TS la fija el test con base.
 */
const MANUAL = sql`(CASE etapa_manual WHEN 'nuevo' THEN 'interesado' WHEN 'venta' THEN 'cierre' ELSE etapa_manual END)`;

/** La etapa efectiva — espejo verificado de `etapaEfectiva(...)`. */
export const etapaEfectivaSql: SQL = sql`CASE
  WHEN etapa_manual IS NULL THEN ${DERIVADA}
  WHEN ${MANUAL} = 'perdido' THEN 'perdido'
  WHEN ${rango(MANUAL)} >= ${rango(DERIVADA)} THEN ${MANUAL}
  ELSE ${DERIVADA}
END`;

/**
 * De dónde sale `etapa_manual`: la ÚLTIMA gestión asentada por conversación
 * (`gestiones` es append-only: la última fila por `creado_at` ES la etapa
 * declarada — la misma regla que `GET /api/gestiones/de/:clave`). Se cruda acá
 * y se normaliza en el CASE de arriba, así el test de paridad también cubre los
 * valores viejos guardados ('nuevo', 'venta').
 *
 * El `id DESC` es el DESEMPATE: dos gestiones pueden caer con el MISMO
 * `creado_at` (mismo tick del reloj, backfill) y sin él el DISTINCT ON elige
 * cualquiera — la etapa quedaría al azar. `id` es bigserial: la última
 * insertada gana, determinista. El índice `gestiones_conversacion_idx`
 * (`db/schema.ts`) acompaña este orden: (clave, creado_at DESC).
 *
 * Este fragmento es EL DISTINCT ON canónico: quien necesite «la última gestión
 * por clave» lo consume de acá, no lo re-escribe — la lección de #37.
 */
export const ultimasGestionesSql: SQL = sql`
  SELECT DISTINCT ON (clave) clave, etapa AS etapa_manual
  FROM gestiones
  ORDER BY clave, creado_at DESC, id DESC
`;
