import { sql } from "drizzle-orm";
import type { db as Db } from "../db/client.js";
import { comoVa, type ComoVaLaCorrida, type EnvioDeCorrida } from "./corridas.js";
import { esAutoRespuestaDeNegocio } from "./autoRespuesta.js";

/**
 * LOS HECHOS CRUDOS DE UNA CAMPAÑA — el SQL, y nada más que el SQL.
 *
 * Ni un `CASE`, ni un umbral, ni una ventana: el veredicto lo da `corridas.ts`,
 * que es puro y tiene tests. Es el mismo patrón que `senales/`, `resultados/` y
 * `atencion/`, y existe por la lección de #37: dos implementaciones del mismo
 * criterio divergen, y la pantalla termina afirmando algo que el filtro no
 * cumple.
 *
 * ⚠️ **La clave de la conversación se DERIVA**, no se lee de
 * `envios_wa.referencia`: una campaña vieja escribió ahí una referencia
 * sintética (`campana:<pieza>:<telefono>`) y cualquier join contra
 * `conversacion_asignada` daba **cero filas en silencio** — 81 conversaciones
 * con dueña salían «sin dueña». Se deriva de `(telefono, numero_propio)`, que es
 * lo que arma el resto de la casa.
 */

type Base = typeof Db;

interface FilaCorrida {
  pieza_ref: string;
  telefono: string;
  estado: string;
  creado_at: string;
  motivo: string | null;
  contesto_en: string | null;
  texto_de_respuesta: string | null;
  lo_atendieron_en: string | null;
  duena: string | null;
}

/**
 * ¿QUÉ CAMPAÑAS HUBO? Una fila por pieza, con su estado completo.
 *
 * `dias` acota hacia atrás. El default cubre un mes, que es más de lo que dura
 * el interés por una campaña — y evita que la pantalla cargue el histórico
 * entero el día que haya cincuenta.
 */
export async function consultarCorridas(
  base: Base,
  opciones: { dias?: number; ahora?: Date } = {},
): Promise<ComoVaLaCorrida[]> {
  const dias = opciones.dias ?? 30;
  const ahora = opciones.ahora ?? new Date();

  const filas = (await base.execute(sql`
    WITH envios AS (
      SELECT pieza_ref, telefono, numero_propio, estado, creado_at, motivo,
             'conv:whatsapp:' || telefono || ':' || numero_propio AS clave
        FROM envios_wa
       WHERE pieza_clase = 'hsm'
         AND creado_at > now() - (${dias} || ' days')::interval
    )
    SELECT e.pieza_ref, e.telefono, e.estado, e.creado_at, e.motivo,
           -- CUÁNDO CONTESTÓ: el primer entrante DESPUÉS de que le llegó.
           -- Sin el «después», cualquiera que alguna vez escribió contaría como
           -- respuesta — y una campaña se manda justamente a gente que escribió.
           (SELECT min(i.occurred_at) FROM interactions i
             WHERE i.persona_id = e.telefono AND i.canal = 'whatsapp'
               AND i.direccion = 'entrante' AND i.occurred_at > e.creado_at) AS contesto_en,
           -- QUE DIJO al contestar. Sin esto no se puede distinguir a una
           -- persona del CONTESTADOR de otro negocio, y la campana sale a
           -- numeros que nunca escribieron -- una parte de esos son empresas.
           (SELECT i.texto FROM interactions i
             WHERE i.persona_id = e.telefono AND i.canal = 'whatsapp'
               AND i.direccion = 'entrante' AND i.occurred_at > e.creado_at
             ORDER BY i.occurred_at LIMIT 1) AS texto_de_respuesta,
           -- CUANDO LO ATENDIERON: un saliente HUMANO posterior a su respuesta.
           -- La condicion automatico = false es lo que hace que el acuse
           -- nocturno, el bot y la propia campana NO cuenten como atencion
           -- (misma regla que atencion/tiempos.ts): si contaran, la pantalla
           -- diria que atendemos siempre y al instante.
           (SELECT min(w.creado_at) FROM envios_wa w
             WHERE w.telefono = e.telefono AND w.estado = 'enviado'
               AND COALESCE(w.automatico, false) = false
               AND w.creado_at > (SELECT min(i2.occurred_at) FROM interactions i2
                                   WHERE i2.persona_id = e.telefono AND i2.canal = 'whatsapp'
                                     AND i2.direccion = 'entrante' AND i2.occurred_at > e.creado_at)
           ) AS lo_atendieron_en,
           a.vendedora_id AS duena
      FROM envios e
      LEFT JOIN conversacion_asignada a ON a.clave = e.clave
     ORDER BY e.pieza_ref, e.creado_at
  `)) as unknown as FilaCorrida[];

  const porPieza = new Map<string, EnvioDeCorrida[]>();
  for (const f of filas) {
    const e: EnvioDeCorrida = {
      telefono: f.telefono,
      estado: f.estado,
      creadoAt: new Date(f.creado_at),
      motivo: f.motivo,
      contestoEn: f.contesto_en ? new Date(f.contesto_en) : null,
      textoDeRespuesta: f.texto_de_respuesta,
      loAtendieronEn: f.lo_atendieron_en ? new Date(f.lo_atendieron_en) : null,
      duena: f.duena,
    };
    const lista = porPieza.get(f.pieza_ref);
    if (lista) lista.push(e);
    else porPieza.set(f.pieza_ref, [e]);
  }

  return [...porPieza.entries()]
    .map(([pieza, envios]) => comoVa(envios, pieza, ahora))
    // La más reciente arriba: es la que se está mirando.
    .sort((a, b) => (b.termino?.getTime() ?? 0) - (a.termino?.getTime() ?? 0));
}

/** Quién contestó una campaña y todavía nadie atendió — la lista de tareas. */
export interface EsperandoDeLaCorrida {
  telefono: string;
  nombre: string | null;
  duena: string | null;
  contestoEn: Date;
  /** Lo que dijo. Es lo que decide a cuál entrar primero. */
  texto: string | null;
  minutosEsperando: number;
}

export async function consultarEsperando(
  base: Base,
  pieza: string,
  opciones: { ahora?: Date; tope?: number } = {},
): Promise<EsperandoDeLaCorrida[]> {
  const ahora = opciones.ahora ?? new Date();
  const tope = opciones.tope ?? 50;

  const filas = (await base.execute(sql`
    WITH envios AS (
      SELECT telefono, numero_propio, min(creado_at) AS le_llego,
             'conv:whatsapp:' || telefono || ':' || numero_propio AS clave
        FROM envios_wa
       WHERE pieza_clase = 'hsm' AND pieza_ref = ${pieza} AND estado = 'enviado'
       GROUP BY telefono, numero_propio
    )
    SELECT e.telefono, r.cuando AS contesto_en, r.texto, r.nombre, a.vendedora_id AS duena
      FROM envios e
      JOIN LATERAL (
        SELECT i.occurred_at AS cuando, i.texto, i.persona_nombre AS nombre
          FROM interactions i
         WHERE i.persona_id = e.telefono AND i.canal = 'whatsapp'
           AND i.direccion = 'entrante' AND i.occurred_at > e.le_llego
         ORDER BY i.occurred_at LIMIT 1
      ) r ON true
      LEFT JOIN conversacion_asignada a ON a.clave = e.clave
     WHERE NOT EXISTS (
       SELECT 1 FROM envios_wa w
        WHERE w.telefono = e.telefono AND w.estado = 'enviado'
          AND COALESCE(w.automatico, false) = false AND w.creado_at > r.cuando
     )
     ORDER BY r.cuando
     LIMIT ${tope}
  `)) as unknown as {
    telefono: string;
    contesto_en: string;
    texto: string | null;
    nombre: string | null;
    duena: string | null;
  }[];

  return filas
    /**
     * ⚠️ EL CONTESTADOR DE OTRO NEGOCIO NO ES UNA TAREA.
     *
     * Se filtra ACÁ y no en el SQL porque el criterio vive puro y con tests
     * (`autoRespuesta.ts`, con el corpus real de producción). Un regex en el
     * WHERE sería la segunda implementación, y la que nadie vuelve a mirar.
     */
    .filter((f) => !esAutoRespuestaDeNegocio(f.texto))
    .map((f) => {
    const contestoEn = new Date(f.contesto_en);
    return {
      telefono: f.telefono,
      nombre: f.nombre,
      duena: f.duena,
      contestoEn,
      texto: f.texto,
      minutosEsperando: Math.round((ahora.getTime() - contestoEn.getTime()) / 60_000),
    };
  });
}
