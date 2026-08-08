import { sql, type SQL } from "drizzle-orm";
import {
  derivadaSql,
  etapaDerivada,
  etapaEfectiva,
  etapaEfectivaSql,
  manualNormalizadaSql,
  SIN_RESPUESTA,
} from "./etapaEfectivaSql.js";
import { normalizarEtapa } from "../gestiones/registrarGestion.js";

/**
 * ¿DESDE CUÁNDO ESTÁ DONDE ESTÁ? — el dato que faltaba para PLANIFICAR.
 *
 * ── Qué pregunta responde, y por qué no la respondía nadie ────────────────
 * El Pipeline muestra conversaciones ordenadas por etapa, y la etapa IGUALA a
 * dos personas que no son lo mismo: una recibió el precio hace 40 minutos, la
 * otra hace tres semanas y no contestó nunca. Lo que las separa —y lo que decide
 * a cuál se le dedica la mañana— no existía en ninguna forma: ni columna, ni
 * derivación, ni gestión. `docs/plan-pipeline-funcional.md` §3.2.
 *
 * ── SE DERIVA, NO SE GUARDA (ADR 0013/0014/0016, otra vez) ────────────────
 * No hay tabla, no hay job y no hay nada que alguien tenga que declarar. Es la
 * condición que el plan pone por escrito y que los datos respaldan: `gestiones`
 * tiene 39 filas en toda la base, `notas` 5 y `eventos_contacto` 1 — **lo que
 * exige que una persona declare algo, no se usa**. Así que el instante sale de
 * hechos que ya ocurrieron.
 *
 * ── LA REGLA: EL MÁS VIEJO DE LOS DOS INGRESOS POSIBLES ───────────────────
 * Una conversación puede estar en su etapa por dos motivos a la vez —alguien la
 * declaró Y el hecho ocurrió— y entonces entró cuando ocurrió el PRIMERO de los
 * dos. Por eso es un `LEAST` de dos candidatos y no un `if/else` con precedencia:
 *
 *   · el DECLARADO — `gestion_at`, si la última gestión asentada dice justamente
 *     esta etapa (`etapaEfectivaSql.ts` la resuelve; acá solo se la compara).
 *   · el DERIVADO — el instante del hecho que la puso ahí, si la derivación
 *     coincide con la etapa efectiva:
 *       `sin_respuesta` → el PRIMER saliente: el silencio corre desde que
 *                         empezamos a escribirle, e insistir no lo reinicia
 *       `cotizado`      → el PRIMER saliente con precio (`cola/precio.ts`)
 *       `contactado`    → el PRIMER saliente posterior al último entrante
 *       `interesado`    → el último entrante (o el primer mensaje)
 *
 * Con precedencia en vez de `LEAST`, el caso «el precio salió el día 1 y alguien
 * tocó Cotizado el día 3» reportaría 3 días menos de antigüedad — justo en la
 * columna donde la antigüedad ES el criterio de trabajo.
 *
 * ── POR QUÉ `contactado` MIRA EL PRIMER SALIENTE TRAS EL ÚLTIMO ENTRANTE ──
 * Porque `respondida` (`urgenciaSql.ts`) es «el último movimiento fue nuestro», y
 * eso **se prende y se apaga**: la persona escribe de nuevo y la conversación
 * vuelve a `interesado`. El plan lo marca como el caso feo (§3.2) y tiene razón:
 * lo que hay que contar es el ÚLTIMO ingreso a la etapa, no el primero de la
 * historia. El primer saliente posterior al último entrante ES ese instante.
 * `min(occurred_at) FILTER (WHERE direccion = 'saliente')` a secas habría dicho
 * «contactada desde el día 1» sobre alguien que volvió a escribir anteayer.
 *
 * ── `null` ES «NO SE PUDO DETERMINAR», NUNCA «RECIÉN» ─────────────────────
 * Un comentario de FB/IG respondido no tiene con qué fechar la respuesta
 * (`interactions.status` no guarda cuándo cambió), así que su `contactado` queda
 * sin fecha. Ahí la pantalla **no dibuja nada**, que es la misma decisión de los
 * ✓✓ de entrega y de `ventana_cierra`: un dato inventado es peor que un hueco,
 * porque el hueco se nota y el invento se cree.
 *
 * ── EXISTE DOS VECES A PROPÓSITO ─────────────────────────────────────────
 * Acá (canónica) y proyectada a SQL, porque la cola pagina y cuenta en la base.
 * El candado es `tiempoEnEtapa.paridad.test.db.ts`, que corre las dos formas
 * contra los mismos datos — el patrón de `urgencia`, `etapaEfectiva`, `precio` y
 * `ventana` (ADR 0009).
 *
 * CONTRATO DE COLUMNAS (como `urgenciaSql.ts` y `etapaEfectivaSql.ts`): quien
 * consuma estos fragmentos tiene que exponer `respondida` · `precio_enviado` ·
 * `hablo` · `ya_le_hablamos` · `etapa_manual` · `gestion_at` ·
 * `primer_precio_at` · `primer_saliente_at` · `respuesta_at` ·
 * `ultimo_entrante_at` · `primer_at`.
 */

/** Los hechos crudos de una conversación, sin ninguna decisión tomada. */
export interface HechosDeEtapa {
  /** La etapa de la última gestión asentada, cruda (`null` si no hay ninguna). */
  etapaManual: string | null;
  /** Cuándo se asentó esa gestión. */
  gestionAt: Date | null;
  respondida: boolean;
  precioEnviado: boolean;
  /** ¿La persona escribió alguna vez? Lo que separa una conversación de una difusión. */
  hablo: boolean;
  /** ¿Salió alguna vez un mensaje nuestro? */
  yaLeHablamos: boolean;
  /** El PRIMER saliente que mandó un precio (`cola/precio.ts`). */
  primerPrecioAt: Date | null;
  /** El PRIMER saliente de todos — cuándo empezamos a escribirle sin respuesta. */
  primerSalienteAt: Date | null;
  /** El PRIMER saliente posterior o igual al último entrante. */
  respuestaAt: Date | null;
  ultimoEntranteAt: Date | null;
  /** El primer mensaje de la conversación — el respaldo de `interesado`. */
  primerAt: Date | null;
}

/**
 * DESDE CUÁNDO ESTÁ EN SU ETAPA EFECTIVA. `null` = no se pudo determinar.
 *
 * La etapa NO se recibe: se calcula con `etapaEfectiva(...)`, la misma función
 * que usa la cola. Pasarla como argumento habría permitido que el llamador
 * fechara el ingreso a una etapa distinta de la que la fila muestra.
 */
export function etapaDesde(h: HechosDeEtapa): Date | null {
  const etapa = etapaEfectiva(h.etapaManual, h.respondida, h.precioEnviado, h.hablo, h.yaLeHablamos);

  const candidatos: Date[] = [];

  // El DECLARADO: la última gestión dice justamente esta etapa.
  const manual = h.etapaManual == null ? null : normalizarEtapa(h.etapaManual);
  if (manual === etapa && h.gestionAt != null) candidatos.push(h.gestionAt);

  // El DERIVADO: el hecho que la puso acá, si el piso coincide con la efectiva.
  if (etapaDerivada(h.respondida, h.precioEnviado, h.hablo, h.yaLeHablamos) === etapa) {
    const hecho =
      etapa === SIN_RESPUESTA
        ? // Desde que EMPEZAMOS a escribirle: es el primer saliente, porque el
          // silencio del otro lado corre desde ahí. Y es el primero y no el
          // último a propósito — insistir no reinicia la espera, la alarga.
          h.primerSalienteAt
        : etapa === "cotizado"
          ? h.primerPrecioAt
          : etapa === "contactado"
            ? h.respuestaAt
            : (h.ultimoEntranteAt ?? h.primerAt);
    if (hecho != null) candidatos.push(hecho);
  }

  if (candidatos.length === 0) return null;
  return candidatos.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * ══ «PARA SEGUIR» — el recorte que convierte una pila en una lista ══════════
 *
 * MEDIDO EN PRODUCCIÓN EL 8-AGO-2026, y corrige dos supuestos del plan §3.1:
 *
 *   etapa       total   en ventana   sin respuesta   s/resp 3-7d   s/resp 3-14d
 *   cotizado    3.051            1           2.928            82            837
 *   contactado    544            0             544            24            293
 *
 * · **«Sin respuesta» NO recorta**: es el 96 % de Cotizados y el 100 % de
 *   Contactados. Un chip que dice 2.928 al lado de 3.051 no es una lista de
 *   trabajo, es el mismo montón con una píldora al lado.
 * · **La ANTIGÜEDAD sí**: es el único eje de los tres que separa 82 de 3.051.
 *
 * Por eso el recorte son las DOS condiciones juntas: silencio nuestro + una
 * antigüedad en la que todavía tiene sentido insistir.
 *
 * 🔴 **EL TECHO TIENE UN COSTO Y SE DICE**: a los 14 días una conversación sale
 * del recorte **sin que nadie la haya tocado**. Eso es deuda que desaparece de
 * la vista, que es exactamente lo que este frente vino a arreglar. La red es la
 * misma que hace aceptable que lo leído baje en la cola: **el chip «Todas» sigue
 * ahí con su número**, y el recorte nunca es el único camino a la columna. Sin
 * ese chip, el techo escondería trabajo en vez de ordenarlo.
 *
 * ⚠️ Y no es un umbral medido: es una ELECCIÓN. Lo medido es la forma de la
 * distribución (3-7d → 106 conversaciones entre las dos columnas; 3-14d → 1.130),
 * no dónde va la raya. Se pone en constantes para que moverla sea un renglón y
 * no una arqueología.
 */
export const SEGUIR_DESDE_DIAS = 3;
export const SEGUIR_HASTA_DIAS = 14;

/** ¿Entra en «Para seguir»? La forma pura, con reloj inyectado (nunca `new Date()` adentro). */
export function paraSeguir(h: HechosDeEtapa, ahora: Date): boolean {
  // Sin silencio nuestro no hay a quién seguir: la pelota es de ellos sólo
  // cuando el último movimiento fue nuestro (`respondida`, `urgenciaSql.ts`).
  if (!h.respondida) return false;
  const desde = etapaDesde(h);
  if (desde == null) return false;
  const dias = (ahora.getTime() - desde.getTime()) / 86_400_000;
  return dias >= SEGUIR_DESDE_DIAS && dias < SEGUIR_HASTA_DIAS;
}

// ── La MISMA regla, dicha en SQL ─────────────────────────────────────────────

/**
 * El instante del hecho que derivó la etapa. Se ramifica sobre `derivadaSql` —el
 * MISMO CASE que la etapa efectiva— y no sobre una copia: agregar un peldaño allá
 * tiene que llegar acá o la fecha queda de la etapa vieja, sin error ni log.
 */
const HECHO_DERIVADO = sql`(CASE ${derivadaSql}
  WHEN ${SIN_RESPUESTA} THEN primer_saliente_at
  WHEN 'cotizado'       THEN primer_precio_at
  WHEN 'contactado'     THEN respuesta_at
  ELSE COALESCE(ultimo_entrante_at, primer_at)
END)`;

/**
 * `etapa_desde` — espejo verificado de `etapaDesde(...)`.
 *
 * `LEAST` ignora los NULL y devuelve el menor de los no nulos, que es justo la
 * semántica de «el más viejo de los ingresos posibles»; con los dos en NULL
 * devuelve NULL, que es «no se pudo determinar». No hace falta ningún COALESCE
 * defensivo, y meterlo convertiría el hueco honesto en una fecha inventada.
 */
export const etapaDesdeSql: SQL = sql`LEAST(
  (CASE WHEN ${manualNormalizadaSql} = (${etapaEfectivaSql}) THEN gestion_at END),
  (CASE WHEN ${derivadaSql} = (${etapaEfectivaSql}) THEN ${HECHO_DERIVADO} END)
)`;

/** «Para seguir» — espejo verificado de `paraSeguir(...)`. El reloj es `now()` de la base. */
export const paraSeguirSql: SQL = sql`(
  respondida
  AND (${etapaDesdeSql}) IS NOT NULL
  AND (${etapaDesdeSql}) <= now() - make_interval(days => ${SEGUIR_DESDE_DIAS})
  AND (${etapaDesdeSql}) >  now() - make_interval(days => ${SEGUIR_HASTA_DIAS})
)`;

// ── Los hechos que estos fragmentos necesitan, dichos donde se agrupan ───────

/**
 * ⚠️ El tercer hecho, `primer_precio_at`, NO vive acá: vive en `cola/precio.ts`,
 * al lado de `precioEnviadoSql` y del regex del que sale. Poner el «cuándo» a
 * un archivo de distancia del «si» habría dejado dos lugares que tienen que
 * cambiar juntos cuando el criterio de precio cambie (#37).
 */

/**
 * El PRIMER saliente posterior o igual al último entrante — el instante en que
 * la conversación pasó a `contactado` **por última vez**.
 *
 * 🔴 **Por qué la subconsulta sobre el `array_agg` y no un `FILTER` a secas**:
 * el predicado necesita comparar cada saliente contra `max(occurred_at) FILTER
 * (WHERE direccion = 'entrante')`, y Postgres **no permite anidar agregados**
 * (`min(...) FILTER (WHERE occurred_at > max(...))` es un error de sintaxis, no
 * un resultado raro). La salida es materializar los salientes del grupo y
 * recorrerlos en una subconsulta escalar, que sí puede leer los agregados del
 * mismo nivel. Verificado contra la base de producción el 8-ago-2026: 544 de 544
 * conversaciones en `contactado` obtuvieron fecha (0 nulos).
 *
 * La alternativa era una window function en el CTE `msg`, que corre sobre las
 * ~13.000 filas de mensajes ANTES de agrupar; ésta corre sobre el array de un
 * grupo, que tiene tantos elementos como salientes tenga esa conversación.
 */
export const respuestaAtSql: SQL = sql`(
  SELECT min(s)
  FROM unnest(array_agg(occurred_at) FILTER (WHERE direccion = 'saliente')) s
  WHERE s >= COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), '-infinity'::timestamptz)
)`;
