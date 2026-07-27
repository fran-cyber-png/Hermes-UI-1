import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { procedenciaDesdeColumnas } from "../procedencia/pieza.js";
import { agregar, type Resultados } from "./agregar.js";
import { VENTANAS_POR_DEFECTO, type HechosDeUnEnvio, type Ventanas } from "./loQuePaso.js";
import { ventasDeConversionesWa, type FuenteDeVentas } from "./ventas.js";

/**
 * EL SEAM DEL LAZO — trae HECHOS, no veredictos.
 *
 * Esta consulta no sabe qué es «funcionó». Trae, por cada envío que salió:
 * cuándo salió, de qué pieza, cuándo llegó el primer mensaje de vuelta, qué
 * gestiones se asentaron después y cuándo. **Ni un `CASE`, ni una ventana, ni
 * un umbral.** Todo eso vive una sola vez, puro, en `loQuePaso.ts`.
 *
 * Es el patrón de `senales/` y no el de `urgenciaSql.ts`: cuando la regla se
 * puede decir en un solo idioma, se dice en uno solo y no hace falta un test de
 * paridad para que no diverja — no hay con qué divergir. El volumen lo permite:
 * un envío es una acción humana, así que `envios_wa` crece al ritmo de una
 * persona escribiendo.
 *
 * Recibe `base` por parámetro (nunca el singleton) para que los tests con base
 * le pasen el suyo — la razón por la que existen los seams (ADR 0008).
 */

export interface OpcionesResultados {
  /** Desde cuándo mirar los envíos. */
  desde: Date;
  ventanas?: Ventanas;
  /** Solo esta vendedora. Sin esto, el equipo entero. */
  vendedoraId?: string;
  /** De dónde sale «¿compró?». Inyectable para poder probar los dos mundos. */
  fuenteDeVentas?: FuenteDeVentas;
}

interface FilaCruda {
  id: number;
  vendedora_id: string;
  referencia: string;
  texto: string;
  salio_en: Date;
  pieza_clase: string | null;
  pieza_ref: string | null;
  pieza_version: string | null;
  pieza_via: string | null;
  pieza_editada: boolean;
  momento_venta: string | null;
  primer_entrante_en: Date | null;
  etapa_antes: string | null;
  etapas_despues: { etapa: string; cuando: string }[] | null;
}

/** Los hechos crudos de cada envío. Sin juicio: eso lo hace `loQuePaso`. */
export async function consultarEnvios(
  base: typeof db,
  o: OpcionesResultados,
): Promise<HechosDeUnEnvio[]> {
  const fuente = o.fuenteDeVentas ?? ventasDeConversionesWa(base);
  const soloVendedora = o.vendedoraId
    ? sql`AND e.vendedora_id = ${o.vendedoraId}`
    : sql``;
  // El corte viaja como STRING ISO con `::timestamptz` explícito. `execute()`
  // baja los params por el bind de `unsafe()`, que espera texto: un `Date` ahí
  // revienta con ERR_INVALID_ARG_TYPE. Es la misma nota de `dashboard/series.ts`.
  const desde = o.desde.toISOString();

  const filas = (await base.execute(sql`
    WITH env AS (
      SELECT e.id, e.vendedora_id, e.referencia, e.texto,
             e.pieza_clase, e.pieza_ref, e.pieza_version, e.pieza_via,
             e.pieza_editada, e.momento_venta,
             -- Cuándo salió DE VERDAD: resuelto_at lo fija marcarEnviado con la
             -- hora que devolvió WhatsApp; creado_at es cuándo se anotó el
             -- intento. Medir contra el segundo le sumaría a cada demora el
             -- tiempo que tardó el transporte.
             COALESCE(e.resuelto_at, e.creado_at) AS salio_en,
             split_part(e.referencia, ':', 2) AS canal,
             split_part(e.referencia, ':', 3) AS persona,
             split_part(e.referencia, ':', 4) AS numero_propio
      FROM envios_wa e
      WHERE e.estado = 'enviado'
        AND e.creado_at >= ${desde}::timestamptz
        AND e.referencia LIKE 'conv:%'
        ${soloVendedora}
    )
    SELECT
      env.id, env.vendedora_id, env.referencia, env.texto, env.salio_en,
      env.pieza_clase, env.pieza_ref, env.pieza_version, env.pieza_via,
      env.pieza_editada, env.momento_venta,
      -- El primer mensaje de vuelta. El número propio entra en la comparación:
      -- quien le escribe a dos números nuestros tiene dos hilos, y cruzarlos
      -- acreditaría a un mensaje la respuesta que la persona le dio a otro.
      (SELECT min(i.occurred_at)
         FROM interactions i
         JOIN events ev ON ev.id = i.event_id
        WHERE i.canal = env.canal
          AND i.persona_id = env.persona
          AND COALESCE(ev.payload->>'numeroPropio', '') = env.numero_propio
          AND i.direccion = 'entrante'
          AND i.occurred_at > env.salio_en)                       AS primer_entrante_en,
      -- La etapa declarada ANTES (el mismo DISTINCT ON de siempre, acotado).
      (SELECT g.etapa
         FROM gestiones g
        WHERE g.clave = env.referencia AND g.creado_at <= env.salio_en
        ORDER BY g.creado_at DESC, g.id DESC LIMIT 1)             AS etapa_antes,
      -- Y las de después, CON su fecha y sin recortar: la ventana la aplica la
      -- función pura, no este WHERE.
      (SELECT jsonb_agg(jsonb_build_object('etapa', g.etapa, 'cuando', g.creado_at))
         FROM gestiones g
        WHERE g.clave = env.referencia AND g.creado_at > env.salio_en)  AS etapas_despues
    FROM env
    ORDER BY env.id
  `)) as unknown as FilaCruda[];

  // «¿Compró?» va aparte: es el seam que depende del PR #165 y el único que
  // hoy puede contestar «no lo sabemos».
  const hayAtribucion = await fuente.hayAtribucion();
  const claves = [...new Set(filas.map((f) => f.referencia))];
  const ventas = hayAtribucion
    ? await fuente.ventasPorClave(claves, o.desde)
    : new Map<string, Date[]>();

  return filas.map((f) => {
    const salioEn = new Date(f.salio_en);
    const posteriores = (ventas.get(f.referencia) ?? [])
      .map((d) => new Date(d))
      .filter((d) => d > salioEn)
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      envioId: f.id,
      clave: f.referencia,
      vendedoraId: f.vendedora_id,
      // El texto va con los hechos: los envíos a mano son la línea de base Y el
      // semillero de piezas nuevas (ver `loQuePaso.ts`).
      texto: f.texto,
      procedencia: procedenciaDesdeColumnas({
        piezaClase: f.pieza_clase,
        piezaRef: f.pieza_ref,
        piezaVersion: f.pieza_version,
        piezaVia: f.pieza_via,
        piezaEditada: Boolean(f.pieza_editada),
        momentoVenta: f.momento_venta,
      }),
      salioEn,
      primerEntranteEn: f.primer_entrante_en ? new Date(f.primer_entrante_en) : null,
      etapaAntes: f.etapa_antes,
      etapasDespues: (f.etapas_despues ?? []).map((g) => ({
        etapa: g.etapa,
        cuando: new Date(g.cuando),
      })),
      ventaEn: posteriores[0] ?? null,
      seSabeDeVentas: hayAtribucion,
    };
  });
}

/** Los hechos, ya contados por pieza. La respuesta a «qué pieza cierra ventas». */
export async function consultarResultados(
  base: typeof db,
  o: OpcionesResultados,
): Promise<Resultados> {
  return agregar(await consultarEnvios(base, o), o.ventanas ?? VENTANAS_POR_DEFECTO);
}
