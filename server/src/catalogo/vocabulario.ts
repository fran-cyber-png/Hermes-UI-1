import {
  DESCRIPCION_MOMENTO,
  INTENCIONES,
  MOMENTOS_DE_VENTA,
  ROTULO_INTENCION,
} from "../sugerencias/estado.js";
import { CLASES_DE_PIEZA, ESTADOS_DE_PIEZA } from "./pieza.js";
import { versionDeContenido } from "./version.js";

/**
 * EL VOCABULARIO, PUBLICADO COMO DATO (H9).
 *
 * ══ POR QUÉ ═════════════════════════════════════════════════════════════════
 *
 * **Ivi es Python y no puede importar `sugerencias/estado.ts`.** Si los dos
 * lados hablan vocabularios distintos, el ensamblado no casa **y falla en
 * silencio**, que es el peor modo de fallar: no hay excepción, hay una pieza
 * elegida para el momento equivocado.
 *
 * La prueba de que hacía falta no viene de Ivi, viene de este repo: el propio
 * front —que ES TypeScript y podría importar— tiene los seis momentos **copiados
 * a mano** en `src/features/hechos/hechos.ts`. Si el lado que puede importar
 * igual duplicó, el lado que no puede no tiene ninguna vía honesta.
 *
 * ══ POR QUÉ NO UN JSON VERSIONADO EN EL REPO ════════════════════════════════
 *
 * Era una de las tres opciones que Ivi ofreció, y es la peor de las tres: un
 * archivo que alguien tiene que acordarse de actualizar es exactamente la
 * desincronización silenciosa que esto viene a evitar. Acá el dato **se deriva**
 * de la fuente única en cada request; el gate de compilación de
 * `DESCRIPCION_MOMENTO` cubre el resto (agregar un momento sin describirlo no
 * compila) y `vocabulario.test.ts` cubre la copia del front.
 *
 * ══ LA `version` ════════════════════════════════════════════════════════════
 *
 * Un hash del vocabulario entero. Ivi lo guarda con su índice: cuando cambia,
 * sabe que tiene que releer sin comparar listas campo por campo. Es el mismo
 * mecanismo que las piezas, por la misma razón.
 */

export interface MomentoPublicado {
  id: string;
  descripcion: string;
}

export interface VocabularioPublicado {
  /** Cambia si cambia cualquier cosa de acá abajo. */
  version: string;
  /**
   * Los momentos, **en orden de especificidad**: el primero que aplica gana.
   * El orden es parte del contrato, no una casualidad del arreglo.
   */
  momentos: MomentoPublicado[];
  /** Lo que una vendedora hace de verdad (lo mide el histórico, no una lluvia de ideas). */
  intenciones: { id: string; rotulo: string }[];
  clases: string[];
  estados: string[];
}

export function vocabularioPublicado(): VocabularioPublicado {
  const momentos = MOMENTOS_DE_VENTA.map((id) => ({ id, descripcion: DESCRIPCION_MOMENTO[id] }));
  const intenciones = INTENCIONES.map((id) => ({ id, rotulo: ROTULO_INTENCION[id] }));
  return {
    version: versionDeContenido([
      ...momentos.flatMap((m) => [m.id, m.descripcion]),
      ...intenciones.flatMap((i) => [i.id, i.rotulo]),
      ...CLASES_DE_PIEZA,
      ...ESTADOS_DE_PIEZA,
    ]),
    momentos,
    intenciones,
    clases: [...CLASES_DE_PIEZA],
    estados: [...ESTADOS_DE_PIEZA],
  };
}
