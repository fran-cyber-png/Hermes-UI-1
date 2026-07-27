import { rotuloDePieza, versionCorta, type Procedencia } from "../procedencia/pieza.js";
import {
  loQuePaso,
  type HechosDeUnEnvio,
  type Ventanas,
  VENTANAS_POR_DEFECTO,
} from "./loQuePaso.js";
import { medir, type Medicion } from "./medicion.js";

/**
 * EL AGREGADO — y también es puro, a propósito.
 *
 * El conteo podría hacerse en un `GROUP BY` y sería más rápido. No se hace, y
 * el motivo es el mismo de siempre en esta casa: sería una SEGUNDA escritura de
 * la regla —una en TS (`loQuePaso`) y otra en SQL— y dos escrituras divergen
 * (la lección de #37). El SQL trae hechos crudos; el veredicto y la suma viven
 * acá, una sola vez.
 *
 * El volumen lo permite de sobra: un envío es una acción humana, así que
 * `envios_wa` crece al ritmo de una persona escribiendo, no de un bot.
 * `consultarResultados.test.db.ts` es el candado contra que alguien «optimice»
 * esto metiéndolo en la consulta.
 *
 * ══ SE AGRUPA POR (CLASE, REF, **VERSIÓN**) ══════════════════════════════════
 *
 * La versión entra en la clave y no es un detalle: si se agrupara solo por
 * pieza, el día que alguien mejore la frase los dos textos se suman y una pieza
 * que pasó de 12 % a 30 % se reporta 21 % **para siempre**. El agrupado por
 * defecto no puede mentir, así que son dos filas.
 *
 * Rollup sigue siendo posible —cada fila lleva `pieza` sin la versión— pero es
 * una decisión explícita del que consulta, no el default silencioso.
 */

/** La clave con la que se agrupa: pieza + versión, o la línea de base. */
export function claveDeAgrupacion(p: Procedencia): string {
  return p.tipo === "a-mano" ? "a-mano" : `${p.clase}:${p.ref}@${versionCorta(p.version)}`;
}

/** La pieza SIN la versión — para quien quiera sumar las versiones a propósito. */
export function piezaDeAgrupacion(p: Procedencia): string {
  return p.tipo === "a-mano" ? "a-mano" : `${p.clase}:${p.ref}`;
}

export interface FilaDeResultados {
  /** `paso:12#3@a1b2c3d4` · `dato:cuotas@…` · `a-mano`. Incluye la versión. */
  clave: string;
  /** La pieza sin versión: `paso:12#3`. Para sumar versiones a propósito. */
  pieza: string;
  /** El sha256 completo del contenido, o `null` si no se supo qué texto era. */
  version: string | null;
  /** Cómo se lee. La línea de base dice que lo es; la pieza muestra su versión. */
  rotulo: string;
  /** `true` para la fila contra la que se compara todo lo demás. */
  esLineaDeBase: boolean;
  /** EL TAMAÑO DE LA MUESTRA. Va primero porque sin él nada de lo demás se puede leer. */
  envios: number;
  /** De esos, cuántos salieron reescritos por la vendedora. */
  editados: number;
  /** Cuándo se usó por primera y última vez: el ORDEN que el hash no da. */
  primerUso: Date;
  ultimoUso: Date;
  respondieron: Medicion;
  avanzaronDeEtapa: Medicion;
  seDeclararonPerdidas: Medicion;
  /**
   * `null` = **no lo sabemos**: la atribución de ventas todavía no está
   * conectada (PR #165). No es «0 ventas» y no se puede dibujar igual.
   */
  ventasDespues: Medicion | null;
  /** La MEDIANA de cuánto tardaron en contestar, sobre los que contestaron. */
  medianaMinutosHastaLaRespuesta: number | null;
  /** Por qué pantallas entró esta pieza, con su conteo. */
  porVia: { via: string; envios: number }[];
}

export interface Resultados {
  ventanas: Ventanas;
  /** Cuántos envíos entraron en total. */
  envios: number;
  /** ¿Se puede responder «¿compró?». Si es `false`, esa columna va en blanco, no en cero. */
  seSabeDeVentas: boolean;
  filas: FilaDeResultados[];
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Junta los envíos por (pieza, versión) y cuenta qué pasó después de cada uno.
 *
 * El orden de salida NO es por tasa: es por **muestra**, de mayor a menor, con
 * la línea de base primero y las versiones de una misma pieza juntas. Ordenar
 * por porcentaje pondría arriba a la pieza de 2/3 —la que menos sabemos— justo
 * donde la vista se posa.
 */
export function agregar(
  hechos: readonly HechosDeUnEnvio[],
  ventanas: Ventanas = VENTANAS_POR_DEFECTO,
): Resultados {
  const grupos = new Map<
    string,
    {
      procedencia: Procedencia;
      envios: number;
      editados: number;
      respondieron: number;
      avanzaron: number;
      perdidas: number;
      ventas: number;
      demoras: number[];
      primerUso: Date;
      ultimoUso: Date;
      vias: Map<string, number>;
    }
  >();

  // Si NINGÚN envío pudo saber de ventas, la columna entera es «no sabemos».
  // Basta con que la fuente esté conectada para que valga en todos.
  const seSabeDeVentas = hechos.some((h) => h.seSabeDeVentas);

  for (const h of hechos) {
    const clave = claveDeAgrupacion(h.procedencia);
    let g = grupos.get(clave);
    if (!g) {
      g = {
        procedencia: h.procedencia,
        envios: 0,
        editados: 0,
        respondieron: 0,
        avanzaron: 0,
        perdidas: 0,
        ventas: 0,
        demoras: [],
        primerUso: h.salioEn,
        ultimoUso: h.salioEn,
        vias: new Map(),
      };
      grupos.set(clave, g);
    }

    const v = loQuePaso(h, ventanas);
    g.envios++;
    if (h.salioEn < g.primerUso) g.primerUso = h.salioEn;
    if (h.salioEn > g.ultimoUso) g.ultimoUso = h.salioEn;
    if (h.procedencia.tipo === "pieza" && h.procedencia.editada) g.editados++;
    if (v.huboRespuesta) g.respondieron++;
    if (v.minutosHastaLaRespuesta !== null) g.demoras.push(v.minutosHastaLaRespuesta);
    if (v.huboAvanceDeEtapa) g.avanzaron++;
    if (v.seDeclaroPerdida) g.perdidas++;
    if (v.huboVentaDespues) g.ventas++;

    const via = h.procedencia.tipo === "pieza" ? h.procedencia.via : "a-mano";
    g.vias.set(via, (g.vias.get(via) ?? 0) + 1);
  }

  const filas: FilaDeResultados[] = [...grupos].map(([clave, g]) => ({
    clave,
    pieza: piezaDeAgrupacion(g.procedencia),
    version: g.procedencia.tipo === "pieza" ? g.procedencia.version : null,
    rotulo: rotuloDePieza(g.procedencia),
    esLineaDeBase: g.procedencia.tipo === "a-mano",
    envios: g.envios,
    editados: g.editados,
    primerUso: g.primerUso,
    ultimoUso: g.ultimoUso,
    respondieron: medir("respondio_despues_de", g.respondieron, g.envios),
    avanzaronDeEtapa: medir("avanzo_de_etapa_despues_de", g.avanzaron, g.envios),
    seDeclararonPerdidas: medir("se_declaro_perdida_despues_de", g.perdidas, g.envios),
    ventasDespues: seSabeDeVentas ? medir("hubo_venta_despues_de", g.ventas, g.envios) : null,
    medianaMinutosHastaLaRespuesta: mediana(g.demoras),
    porVia: [...g.vias]
      .map(([via, envios]) => ({ via, envios }))
      .sort((a, b) => b.envios - a.envios || a.via.localeCompare(b.via)),
  }));

  // Las versiones de una misma pieza quedan JUNTAS y en orden cronológico: es
  // lo único que hace visible «el texto nuevo funcionó mejor». El hash no da
  // orden; `primerUso` sí.
  const enviosPorPieza = new Map<string, number>();
  for (const f of filas) enviosPorPieza.set(f.pieza, (enviosPorPieza.get(f.pieza) ?? 0) + f.envios);

  filas.sort(
    (a, b) =>
      Number(b.esLineaDeBase) - Number(a.esLineaDeBase) ||
      (enviosPorPieza.get(b.pieza) ?? 0) - (enviosPorPieza.get(a.pieza) ?? 0) ||
      a.pieza.localeCompare(b.pieza) ||
      a.primerUso.getTime() - b.primerUso.getTime() ||
      a.clave.localeCompare(b.clave),
  );

  return { ventanas, envios: hechos.length, seSabeDeVentas, filas };
}
