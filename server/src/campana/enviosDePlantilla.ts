import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { consultarEnvios, type OpcionesResultados } from "../resultados/consultarResultados.js";
import {
  VENTANAS_POR_DEFECTO,
  loQuePaso,
  type HechosDeUnEnvio,
  type Ventanas,
} from "../resultados/loQuePaso.js";
import { medir, type Medicion } from "../resultados/medicion.js";

/**
 * CUÁNTO SE MANDÓ CON ESTA PLANTILLA — y qué pasó después.
 *
 * ══ POR QUÉ ESTO EXISTE ═════════════════════════════════════════════════════
 *
 * Medido el 10-ago-2026 en producción: la campaña del foro dejó **1.004 filas**
 * en `envios_wa` con su procedencia estampada (`hsm:foro_estado_5_ago`), y no
 * había **una sola pantalla** que las mostrara. «Quién mandó qué» lee
 * `corridas_campana` —que tiene 0 filas, porque esa campaña salió por script y
 * no dejó firma de autorización— y el único lector que agrupa `envios_wa` por
 * pieza es un script de terminal (`piezas:resultados`, ADR 0022).
 *
 * O sea: el hecho estaba guardado, completo y correcto, y la vendedora que mandó
 * mil mensajes no tenía forma de saber cuántos salieron.
 *
 * ⚠️ **La salida NO es backfillear `corridas_campana`.** Esa tabla responde
 * «quién AUTORIZÓ», y escribirle una fila por una campaña que nadie autorizó
 * desde la app sería falsificar justo la firma que existe para auditar. El hecho
 * de los envíos vive en `envios_wa`; esto lo lee de ahí.
 *
 * ══ 🔴 CUÁNTOS SALIERON Y CUÁNTOS SE PUEDEN MEDIR SON DOS NÚMEROS ═══════════
 *
 * Y confundirlos hace que la pantalla mienta justo donde más duele. Medido el
 * mismo día, sobre las dos campañas que existen:
 *
 *   · `foro_estado_5_ago` → `conv:whatsapp:<tel>:<linea>` en las 1.004 filas.
 *   · `promo_3x1_cursos`  → **`campana:promo_3x1_cursos:<tel>` en las 89.**
 *
 * `consultarEnvios` sólo mira `referencia LIKE 'conv:%'`, y con razón: para
 * saber si alguien contestó hay que saber en qué conversación mirar. Pero eso
 * significa que los 89 son **invisibles** para el lazo de resultados — y una
 * primera versión de este archivo los contaba desde ahí, así que la tarjeta de
 * `promo_3x1_cursos` decía «todavía no se mandó ninguna vez» sobre 89 envíos
 * reales. Es el mismo cero engañoso que este frente vino a arreglar.
 *
 * Por eso **cuántos salieron se cuenta aparte, sobre `envios_wa` entero**, y
 * `medibles` viaja al lado para que la pantalla pueda decir «salieron 88 y de
 * ninguno se puede saber si contestó» en vez de «contestaron 0 de 0».
 *
 * ══ SE AGRUPA POR PLANTILLA, NO POR (PLANTILLA, VERSIÓN) ════════════════════
 *
 * `resultados/agregar.ts` agrupa por versión a propósito: sin eso, mejorar una
 * frase suma los dos textos y una pieza que pasó de 12 % a 30 % se reporta 21 %
 * para siempre. Acá la pregunta es otra —«¿cuánto se mandó ESTA plantilla?»— y
 * su respuesta es el rollup, que el propio módulo declara posible **como
 * decisión explícita del que consulta**.
 *
 * Y como el rollup puede tapar que hubo dos textos, `versiones` viaja en la
 * respuesta: la pantalla puede decir «se mandó con 2 textos distintos» en vez de
 * fingir que el número es de uno solo.
 *
 * Nada de esto reimplementa una regla: `loQuePaso` sigue siendo quien dice qué
 * pasó después de cada envío y `medir` el único constructor de una `Medicion`.
 * Lo propio de acá es la clave de agrupación y el universo. El candado es
 * `enviosDePlantilla.test.ts`.
 */

/** Los envíos de una plantilla, con lo que pasó después. */
export interface EnviosDeUnaPlantilla {
  /** El nombre en Meta — la misma `pieza_ref` que estampó el envío. */
  plantilla: string;
  /** Cuántos SALIERON de verdad. Todos, se puedan medir o no. */
  salieron: number;
  /**
   * Cuántos NO salieron (`fallido`, o un `pendiente` que quedó colgado).
   * Se dice aparte y nunca se suma: mezclarlos convertiría un fracaso de
   * entrega en alcance.
   */
  noSalieron: number;
  /**
   * De los que salieron, cuántos quedaron atados a una conversación — o sea de
   * cuántos se puede saber si contestaron. **Es el denominador de
   * `respondieron`**, y cuando es menor que `salieron` la pantalla lo tiene que
   * decir: `promo_3x1_cursos` salió 88 veces con `medibles = 0`.
   */
  medibles: number;
  primerUso: Date;
  ultimoUso: Date;
  /**
   * Cuántos TEXTOS distintos salieron bajo este nombre (ADR 0022). Casi siempre
   * 1. Si es más, el porcentaje de acá mezcla versiones y la pantalla lo dice.
   */
  versiones: number;
  respondieron: Medicion;
  /** La MEDIANA de cuánto tardaron, sobre los que contestaron. */
  medianaMinutosHastaLaRespuesta: number | null;
}

export interface EnviosPorPlantilla {
  desde: Date;
  /**
   * LA LÍNEA DE BASE: lo que la vendedora escribió a mano en la misma ventana.
   *
   * Va en la misma respuesta y no en otra consulta porque un 3 % no significa
   * nada solo. Es el mismo criterio de ADR 0022: `null` no es un hueco, es
   * contra lo que se compara todo. `null` acá = no hubo ni un envío a mano en la
   * ventana, o sea que no hay con qué comparar — nunca «la base es 0 %».
   */
  lineaDeBase: { envios: number; respondieron: Medicion } | null;
  plantillas: EnviosDeUnaPlantilla[];
}

/** Lo que se intentó mandar con una plantilla, mirando `envios_wa` entero. */
export interface IntentosDeUnaPlantilla {
  salieron: number;
  noSalieron: number;
  primero: Date;
  ultimo: Date;
}
export type IntentosPorPlantilla = Map<string, IntentosDeUnaPlantilla>;

/**
 * CUÁNTO SE INTENTÓ MANDAR — el universo completo, sin el filtro del seam.
 *
 * Acá **no** va `referencia LIKE 'conv:%'`, y esa ausencia es la decisión de
 * todo el archivo: ese filtro es correcto para medir y sería una mentira para
 * contar. Los 89 envíos de `promo_3x1_cursos` no tienen clave de conversación y
 * salieron igual.
 *
 * Las fechas salen de acá por lo mismo: una plantilla que salió 88 veces sin
 * conversación tiene que poder decir CUÁNDO salió, y los hechos del seam no la
 * conocen.
 */
export async function contarIntentos(
  base: typeof db,
  desde: Date,
): Promise<IntentosPorPlantilla> {
  const filas = (await base.execute(sql`
    SELECT e.pieza_ref                                         AS pieza_ref,
           count(*) FILTER (WHERE e.estado = 'enviado')::int    AS salieron,
           count(*) FILTER (WHERE e.estado <> 'enviado')::int   AS no_salieron,
           min(e.creado_at)                                     AS primero,
           max(e.creado_at)                                     AS ultimo
      FROM envios_wa e
     WHERE e.pieza_clase = 'hsm'
       AND e.pieza_ref IS NOT NULL
       AND e.creado_at >= ${desde.toISOString()}::timestamptz
     GROUP BY 1
  `)) as unknown as {
    pieza_ref: string;
    salieron: number;
    no_salieron: number;
    primero: string;
    ultimo: string;
  }[];

  return new Map(
    filas.map((f) => [
      f.pieza_ref,
      {
        salieron: Number(f.salieron),
        noSalieron: Number(f.no_salieron),
        primero: new Date(f.primero),
        ultimo: new Date(f.ultimo),
      },
    ]),
  );
}

/**
 * El rollup por plantilla. Puro: recibe los hechos y los intentos, y cuenta.
 *
 * El orden es por MUESTRA, de mayor a menor — igual que `agregar()` y por el
 * mismo motivo: ordenar por tasa pondría arriba a la plantilla de 2 envíos,
 * justo donde se posa la vista.
 */
export function agregarPorPlantilla(
  hechos: readonly HechosDeUnEnvio[],
  intentos: IntentosPorPlantilla = new Map(),
  ventanas: Ventanas = VENTANAS_POR_DEFECTO,
  desde: Date = new Date(0),
): EnviosPorPlantilla {
  interface Medibles {
    medibles: number;
    respondieron: number;
    demoras: number[];
    versiones: Set<string>;
  }
  const porRef = new Map<string, Medibles>();
  let baseEnvios = 0;
  let baseRespondieron = 0;

  for (const h of hechos) {
    const v = loQuePaso(h, ventanas);

    // La línea de base es lo escrito a mano. Se cuenta acá y no en otra pasada
    // para que salga de EXACTAMENTE los mismos hechos que las plantillas: dos
    // recorridos con dos filtros es cómo nacen los dos números que no cierran.
    if (h.procedencia.tipo === "a-mano") {
      baseEnvios++;
      if (v.huboRespuesta) baseRespondieron++;
      continue;
    }
    if (h.procedencia.clase !== "hsm") continue;

    const ref = h.procedencia.ref;
    let m = porRef.get(ref);
    if (!m) {
      m = { medibles: 0, respondieron: 0, demoras: [], versiones: new Set() };
      porRef.set(ref, m);
    }

    m.medibles++;
    // `null` es «no se pudo determinar qué texto era» y NO es una versión: si
    // contara, una plantilla sin versión conocida diría «1 texto» y sería falso.
    if (h.procedencia.version !== null) m.versiones.add(h.procedencia.version);
    if (v.huboRespuesta) m.respondieron++;
    if (v.minutosHastaLaRespuesta !== null) m.demoras.push(v.minutosHastaLaRespuesta);
  }

  // El universo son los INTENTOS, no los hechos: una plantilla que salió sin
  // clave de conversación no aparece en los hechos y salió igual. Si sólo se
  // armara desde los hechos, la pantalla diría «todavía no se mandó» de algo
  // que se mandó 88 veces.
  const nombres = new Set([...intentos.keys(), ...porRef.keys()]);

  const plantillas: EnviosDeUnaPlantilla[] = [...nombres]
    .map((plantilla) => {
      const i = intentos.get(plantilla);
      const m = porRef.get(plantilla);
      const medibles = m?.medibles ?? 0;
      return {
        plantilla,
        // Sin fila de intentos —imposible hoy, porque es un superconjunto— se
        // cae a lo medible antes que a cero: es el número que sí se conoce.
        salieron: i?.salieron ?? medibles,
        noSalieron: i?.noSalieron ?? 0,
        medibles,
        primerUso: i?.primero ?? desde,
        ultimoUso: i?.ultimo ?? desde,
        versiones: m?.versiones.size ?? 0,
        respondieron: medir("respondio_despues_de", m?.respondieron ?? 0, medibles),
        medianaMinutosHastaLaRespuesta: mediana(m?.demoras ?? []),
      };
    })
    .sort(
      (a, b) =>
        b.salieron + b.noSalieron - (a.salieron + a.noSalieron) ||
        a.plantilla.localeCompare(b.plantilla),
    );

  return {
    desde,
    lineaDeBase:
      baseEnvios > 0
        ? {
            envios: baseEnvios,
            respondieron: medir("respondio_despues_de", baseRespondieron, baseEnvios),
          }
        : null,
    plantillas,
  };
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Los envíos de cada plantilla en la ventana, listos para la pantalla. */
export async function consultarEnviosDePlantillas(
  base: typeof db,
  o: OpcionesResultados,
): Promise<EnviosPorPlantilla> {
  const [hechos, intentos] = await Promise.all([
    consultarEnvios(base, o),
    contarIntentos(base, o.desde),
  ]);
  return agregarPorPlantilla(hechos, intentos, o.ventanas ?? VENTANAS_POR_DEFECTO, o.desde);
}
