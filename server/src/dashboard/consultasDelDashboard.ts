import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { fuenteLeadSql, productoLeadSql } from './fuenteLead.js';
import { soloMisClavesSql } from './personal.js';

/**
 * LAS CUATRO CONSULTAS QUE LE QUEDABAN SUELTAS AL DASHBOARD — extraídas de
 * `routes/dashboard.ts` por el MISMO motivo que `dashboard/series.ts`,
 * `dashboard/porVendedora.ts` y `cola/consultarRadar.ts`: el SQL escrito adentro
 * de un router no se puede probar contra una base de verdad. El propio
 * `routes/dashboard.test.db.ts` lo dice en su docblock: `GET /` no se puede
 * testear desde ahí porque el router importa el singleton `db`, que apunta a
 * OTRA base que la del test — sembrar de un lado y leer del otro da un verde que
 * no significa nada.
 *
 * Cada función recibe `base` INYECTADA como primer parámetro —el patrón de la
 * casa: `consultarSenales`, `consultarPorVendedora`, `consultarSeriesDashboard`—:
 * la ruta le pasa el singleton, el test con base efímera le pasa el suyo
 * (ADR 0008).
 *
 * ⚠️ **ES UNA MUDANZA, NO UNA MEJORA.** El SQL es literalmente el mismo texto,
 * con los mismos parámetros y el mismo orden de filas que tenía el router. Nada
 * se corrigió ni se optimizó de paso: un cambio de comportamiento escondido
 * adentro de una extracción es imposible de encontrar después, porque el diff
 * que hay que leer es «se movió un archivo».
 */

/** Un lead de formulario, como lo devuelve Postgres. `type` y no `interface`:
 *  `db.execute<T>` exige la index signature implícita que las interfaces no tienen. */
export type FilaFormulario = {
  clave: string;
  fuente: string;
  canal: string;
  persona_nombre: string | null;
  telefono: string | null;
  correo: string | null;
  pais_dato: string | null;
  producto: string | null;
  campana: string | null;
  flyer: string | null;
  es_organico: boolean | null;
  estado_lead: string;
  cayo_at: string;
};

/** Lo asentado a mano por clave: la última etapa que alguien declaró. */
export type FilaEtapaAsentada = {
  clave: string;
  etapa: string;
};

/** Una etiqueta manual colgada de una clave (#48). Varias por clave. */
export type FilaEtiqueta = {
  clave: string;
  etiqueta: string;
};

/** Un renglón del ranking de intereses: el curso y cuántas veces lo pidieron. */
export type FilaCursoPedido = {
  curso: string;
  n: number;
};

/**
 * Lo que cayó por FORMULARIO: Lead Ads de Meta + landings (webhook Bravo).
 *
 * ⚠️ CON RECORTE PERSONAL NO VAN. Un lead de formulario no tiene dueño: el
 * reparto asigna CONVERSACIONES (`conversacion_asignada`, por clave `conv:…`) y
 * un lead todavía no es una. Servirlos igual sería mezclar «lo mío» con «lo de
 * todos» adentro de una misma lista que se presenta como propia, y elegir a
 * cuál de los dos criterios pertenece cada fila quedaría del lado de quien
 * mira. Se van enteros, y la respuesta lo DICE (`soloMisAsignadas`) para que la
 * pantalla explique el hueco en vez de mostrar chips en cero sin motivo.
 */
export async function consultarLeadsDeFormulario(
  base: typeof db,
  soloAsignadasA: string | null,
): Promise<FilaFormulario[]> {
  if (soloAsignadasA !== null) return [];

  return base.execute<FilaFormulario>(sql`
    SELECT
      'lead:' || lead_id AS clave,
      -- De dónde vino y de qué: las dos reglas viven en dashboard/fuenteLead.ts
      -- con su test. Acá decía platform = 'landing', que NO MATCHEA NINGUNA
      -- FILA (icarus escribe 'web'), así que los 25.511 leads de landing se
      -- mostraban como «Lead Ad» y el chip «Landings» quedaba en cero para
      -- siempre — el panel decía que el canal muerto traía gente y el vivo no.
      (${fuenteLeadSql}) AS fuente,
      COALESCE(platform, 'fb') AS canal,
      full_name AS persona_nombre,
      phone AS telefono,
      email AS correo,
      country AS pais_dato,
      -- ⚠️ Acá decía COALESCE(form_name, campaign_name), que elegía EL PEOR de
      -- los dos: form_name siempre existe para icarus (icarus:landing, un
      -- placeholder con namespace) y tapaba a campaign_name, que es donde vive
      -- el nombre del diploma. La fila mostraba un id interno.
      (${productoLeadSql}) AS producto,
      campaign_name AS campana,
      ad_name AS flyer,
      is_organic AS es_organico,
      status AS estado_lead,
      created_time AS cayo_at
    FROM leads
    WHERE created_time > now() - interval '14 days'
    ORDER BY created_time DESC
    LIMIT 60
  `);
}

/**
 * El mapa de Estado: la etapa asentada a mano más reciente de cada clave.
 *
 * `DISTINCT ON (clave) … ORDER BY clave, creado_at DESC` es «la última gestión
 * de cada conversación», no todas. Es lo asentado a mano y NO la etapa efectiva
 * del embudo (ADR 0044) — quien quiere ésa llama a `contarPorEtapaEfectiva`.
 */
export async function consultarEtapasAsentadas(base: typeof db): Promise<FilaEtapaAsentada[]> {
  return base.execute<FilaEtapaAsentada>(sql`
    SELECT DISTINCT ON (clave) clave, etapa FROM gestiones ORDER BY clave, creado_at DESC
  `);
}

/**
 * Las etiquetas manuales, en el orden en que se pusieron.
 *
 * Vienen crudas —una fila por etiqueta— y quien las consume las agrupa por
 * clave: el `ORDER BY creado_at` es lo que hace que ese agrupado salga en el
 * orden en que la vendedora las fue colgando.
 */
export async function consultarEtiquetas(base: typeof db): Promise<FilaEtiqueta[]> {
  return base.execute<FilaEtiqueta>(sql`
    SELECT clave, etiqueta FROM etiquetas ORDER BY creado_at
  `);
}

/**
 * Qué cursos pide la gente: el ranking de intereses. Señal de negocio pura.
 *
 * `intereses` se cuelga de la CLAVE de la conversación, así que el recorte
 * personal es el mismo de siempre y no hace falta una segunda definición.
 */
export async function consultarCursosPedidos(
  base: typeof db,
  soloAsignadasA: string | null,
): Promise<FilaCursoPedido[]> {
  return base.execute<FilaCursoPedido>(sql`
    SELECT curso, count(*)::int AS n FROM intereses
    WHERE ${soloMisClavesSql(sql`clave`, soloAsignadasA)}
    GROUP BY curso ORDER BY n DESC, curso LIMIT 6
  `);
}
