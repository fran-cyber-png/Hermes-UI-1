import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { consultarSenales } from "../senales/consultarSenales.js";
import { listarPlantillas } from "../plantillas/repositorio.js";
import { sugerirDos, type Sugerencia } from "./sugerir.js";
import type { EstadoDeVenta } from "./estado.js";

/**
 * EL SEAM DE LAS DOS RESPUESTAS: junta lo que ya calculan los otros dos frentes
 * y no vuelve a calcular nada.
 *
 *   · **si se cotizó y si se enfrió** → `senales/consultarSenales.ts` (PR 1);
 *   · **qué secuencias tiene la vendedora** → `plantillas/repositorio.ts` (PR 2);
 *   · **qué corresponde** → `sugerencias/estado.ts` (puro, compartido con la
 *     auto-respuesta de #125).
 *
 * Lo único que agrega es el puñado de hechos que ninguno de los dos tenía:
 * cuántas veces le escribimos, si el último mensaje suyo pide información, y
 * qué curso tiene registrado.
 */

/** Las palabras con las que alguien pide información en un chat de la Escuela. */
const RE_PIDE_INFO = /info|informacion|información|precio|costo|cuanto|cuánto|temario|inscrib|matric/i;

interface HechosFila {
  salientes: number;
  con_media: boolean;
  temario: boolean;
  ultimo_entrante: string | null;
  curso: string | null;
}

export interface ResultadoSugerencias {
  estado: EstadoDeVenta;
  sugerencias: Sugerencia[];
}

export async function consultarSugerencias(
  base: typeof db,
  o: { clave: string; vendedoraId: string; ahora?: Date },
): Promise<ResultadoSugerencias> {
  const partes = o.clave.split(":");
  const personaId = partes[2] ?? "";
  const canal = partes[1] ?? "";
  const numeroPropio = partes[3] ?? "";

  const [hechos] = (await base.execute(sql`
    WITH msg AS (
      SELECT i.direccion, i.texto, i.occurred_at,
             (e.payload->'media' IS NOT NULL AND e.payload->>'media' <> 'null') AS con_media
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.canal = ${canal}
        AND i.persona_id = ${personaId}
        AND COALESCE(e.payload->>'numeroPropio', '') = ${numeroPropio}
    )
    SELECT
      (SELECT count(*)::int FROM msg WHERE direccion = 'saliente')                             AS salientes,
      (SELECT bool_or(con_media) FROM msg WHERE direccion = 'saliente')                        AS con_media,
      (SELECT bool_or(texto ~* 'temario') FROM msg WHERE direccion = 'saliente')               AS temario,
      (SELECT texto FROM msg WHERE direccion = 'entrante' ORDER BY occurred_at DESC LIMIT 1)   AS ultimo_entrante,
      (SELECT curso FROM intereses WHERE clave = ${o.clave} ORDER BY creado_at DESC LIMIT 1)   AS curso
  `)) as unknown as HechosFila[];

  const senales = await consultarSenales(base, { claves: [o.clave], ahora: o.ahora });
  const senal = senales[o.clave];

  const estado: EstadoDeVenta = {
    esPrimerContacto: (hechos?.salientes ?? 0) === 0,
    curso: hechos?.curso ?? null,
    pidioInfo: RE_PIDE_INFO.test(hechos?.ultimo_entrante ?? ""),
    cotizada: Boolean(senal?.cotizacion?.esCotizacion),
    enfriada: Boolean(senal?.enfriamiento.enfriada),
    vioMaterial: Boolean(hechos?.con_media || hechos?.temario),
  };

  const plantillas = await listarPlantillas(base, o.vendedoraId);
  return { estado, sugerencias: sugerirDos(estado, plantillas) };
}
