import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";

/**
 * LAS PIEZAS DEL PREFLIGHT DE LA FRONTERA — el veredicto PURO y las dos
 * lecturas. El CLI que las usa es `scripts/preflightFrontera.ts`.
 *
 * Está partido en dos por lo mismo que `resultados/medicion.ts`: **el veredicto
 * tiene que poder interrogarse sin base**. Un preflight es una decisión de
 * «desplegar o no» y su regla no puede vivir adentro de un `console.log`.
 *
 * ⚠️ **Todo acá es SOLO LECTURA.** Ningún `INSERT`, ningún `UPDATE`.
 */

type Base = Pick<typeof db, "execute">;

/** Lo medido de una persona, con la frontera puesta. */
export interface FilaPreflight {
  vendedoraId: string;
  esSupervisora: boolean;
  /** Cuántas conversaciones le serviría la cola HOY, con la frontera aplicada. */
  total: number;
  /** De ésas, cuántas son suyas (`?mios=1`). */
  propias: number;
  /** El resto: lo huérfano que su alcance de línea le deja ver. */
  huerfanas: number;
}

export interface Umbrales {
  /**
   * Cuántas huérfanas puede arrastrar una persona antes de que esto se considere
   * «la cláusula de línea no está acotando nada».
   *
   * ⚠️ **No es un número de calidad, es un detector de regla apagada.** En la
   * medición del plan (15-ago-2026) las huérfanas de la ventana eran 2.875, casi
   * todas de dos líneas retiradas: si con la frontera puesta alguien sigue
   * viendo miles, la cláusula no está discriminando y la mesa volvió a ser de
   * todos. El default (500) está muy por debajo de ese archivo y muy por encima
   * de lo que la línea viva produce (0 huérfanas medidas ahí).
   */
  maxHuerfanas: number;
}

export interface Veredicto {
  ok: boolean;
  problemas: string[];
}

/**
 * 🔴 FALLA POR LOS DOS LADOS, Y ÉSA ES LA RAZÓN DE SER DEL SCRIPT.
 *
 * Un preflight que sólo mirara «¿alguien quedó en cero?» aprobaría una frontera
 * que no recorta nada; uno que sólo mirara «¿recorta?» aprobaría una que dejó a
 * media empresa sin cola. Los dos errores se cometen el mismo día y por el mismo
 * cambio, así que se preguntan juntos.
 *
 * ⚠️ **Una supervisora en cero también es un problema.** Ve todo por definición,
 * así que cero significa que la cola entera está vacía —base equivocada, ventana
 * de 30 días vencida, ingesta caída— y eso invalida la medición de todas las
 * demás: sin este chequeo, «todas ven poco» se leería como «la frontera anda».
 */
export function veredictoDelPreflight(
  filas: readonly FilaPreflight[],
  umbrales: Umbrales,
): Veredicto {
  const problemas: string[] = [];

  if (filas.length === 0) {
    return { ok: false, problemas: ["no se midió a NADIE: un preflight sin filas no verifica nada"] };
  }

  for (const f of filas) {
    if (f.total === 0) {
      problemas.push(
        `${f.vendedoraId} quedaría con la cola VACÍA (rol ${f.esSupervisora ? "supervisora" : "vendedora"}). ` +
          `Se lee como «la app perdió mis conversaciones», no como «no te asignaron nada».`,
      );
    }
    if (f.huerfanas > umbrales.maxHuerfanas) {
      problemas.push(
        `${f.vendedoraId} arrastra ${f.huerfanas} huérfanas (techo ${umbrales.maxHuerfanas}): ` +
          `la cláusula de línea no está acotando — revisá \`numero_vendedora\` antes de desplegar.`,
      );
    }
  }

  // Que TODAS vean exactamente lo mismo es la firma de una frontera apagada: con
  // el reparto vivo, dos personas distintas no pueden ver el mismo número salvo
  // que el recorte no se esté aplicando. Se dice aparte porque cada fila, por sí
  // sola, se ve razonable.
  const vendedoras = filas.filter((f) => !f.esSupervisora);
  const totales = new Set(vendedoras.map((f) => f.total));
  if (vendedoras.length > 1 && totales.size === 1) {
    problemas.push(
      `las ${vendedoras.length} vendedoras ven EXACTAMENTE lo mismo (${[...totales][0]}): ` +
        `eso es lo que se ve cuando la frontera no se aplica.`,
    );
  }

  return { ok: problemas.length === 0, problemas };
}

/**
 * QUIÉN CUENTA COMO «IDENTIDAD ACTIVA» — la UNIÓN de tres tablas, no una.
 *
 * 🔴 **Ninguna de las tres alcanza sola, y el contraejemplo tiene nombre.**
 * `tracy` tiene conversaciones asignadas y **no está en `numero_vendedora`**; hay
 * quien está en el mapa de líneas y no en la rueda; y la rueda tiene bajas
 * lógicas. Un preflight construido sobre una sola de las tres deja afuera justo a
 * quien más raro le va a quedar la frontera.
 *
 * ⚠️ **`activa` sólo se filtra en la rueda**, que es la única de las tres que
 * tiene baja lógica. Estar en `numero_vendedora` o tener conversaciones
 * asignadas es un hecho, no un permiso — y si alguien ya no trabaja acá, lo que
 * hay que arreglar es esa fila, no esconderla del preflight.
 *
 * ⚠️ Hermes **no tiene tabla de personas**, así que esto es lo más cerca de un
 * padrón que se puede armar hoy. El día que exista `equipo`, esta función se
 * reemplaza por un `SELECT` de esa tabla y el resto del script no se toca.
 */
export async function identidadesActivas(
  base: Base,
): Promise<{ vendedoraId: string; origenes: string[] }[]> {
  const filas = await base.execute<{ vendedora_id: string; origenes: string[] }>(sql`
    WITH todas AS (
      SELECT vendedora_id, 'rueda' AS origen FROM reparto_rueda WHERE activa = 'si'
      UNION ALL
      SELECT vendedora_id, 'linea' AS origen FROM numero_vendedora
      UNION ALL
      SELECT vendedora_id, 'asignadas' AS origen FROM conversacion_asignada
    )
    SELECT lower(btrim(vendedora_id))            AS vendedora_id,
           array_agg(DISTINCT origen ORDER BY origen) AS origenes
      FROM todas
     WHERE btrim(vendedora_id) <> ''
     GROUP BY 1
     ORDER BY 1
  `);
  return filas.map((f) => ({ vendedoraId: f.vendedora_id, origenes: f.origenes }));
}

/**
 * EL ALCANCE DE LÍNEA DE UNA PERSONA, tal como lo ve la frontera.
 *
 * ⚠️ **Normaliza los dos lados**, igual que la cláusula (`lineaAlcanzableSql`).
 * Con `eq()` exacto —lo que hace `lineasDeVendedoraConProposito`— `Luz` no
 * reconocería su propia línea y el preflight informaría un alcance que no es el
 * que el server va a aplicar. Un preflight que mide otra cosa que la regla es
 * peor que ninguno.
 *
 * Es informativo: quien decide es `consultarCola`. Se imprime para que, cuando
 * el veredicto falle, se vea POR QUÉ sin abrir psql.
 */
export async function leerAlcance(
  base: Base,
  vendedoraId: string,
): Promise<{ mias: string[]; lineasConDuena: string[] }> {
  const limpio = vendedoraId.trim().toLowerCase();
  const filas = await base.execute<{ numero: string; es_mia: boolean }>(sql`
    SELECT numero,
           bool_or(lower(btrim(vendedora_id)) = ${limpio}) AS es_mia
      FROM numero_vendedora
     GROUP BY numero
     ORDER BY numero
  `);
  return {
    mias: filas.filter((f) => f.es_mia).map((f) => f.numero),
    lineasConDuena: filas.map((f) => f.numero),
  };
}
