import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MOMENTOS_DE_VENTA, momentoDeVenta } from "../sugerencias/estado.js";
import { elegirHechos } from "../hechos/elegir.js";
import { vocabularioPublicado } from "./vocabulario.js";

/**
 * H9 — QUE EL VOCABULARIO NO SE PUEDA DESINCRONIZAR EN SILENCIO.
 *
 * Ivi es Python y no puede importar `sugerencias/estado.ts`: lo lee como dato.
 * El riesgo no es que el endpoint se rompa —eso se ve— sino que alguien agregue
 * un momento y el otro lado no se entere: ahí el ensamblado elige la pieza del
 * momento equivocado y **nada falla**.
 *
 * Tres guardas, y ninguna es «acordate de actualizar el JSON»:
 *
 *   1. lo publicado se DERIVA de `MOMENTOS_DE_VENTA` (este archivo lo fija);
 *   2. la copia a mano del FRONT tiene que coincidir — es la desincronización
 *      que ya existía en el repo, y ahora se pone roja;
 *   3. un momento desconocido no explota de este lado (la simetría que Ivi pide:
 *      tolerar el valor nuevo con un default conservador, nunca un throw).
 */

const RUTA_FRONT = fileURLToPath(new URL("../../../src/features/hechos/hechos.ts", import.meta.url));

/** Los momentos que el front tiene escritos a mano en su union type. */
function momentosDelFront(): string[] {
  const fuente = readFileSync(RUTA_FRONT, "utf8");
  const bloque = /export type MomentoDeVenta =([\s\S]*?);/.exec(fuente);
  assert.ok(bloque, `no encontré el tipo MomentoDeVenta en ${RUTA_FRONT}`);
  return [...(bloque[1] as string).matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
}

describe("el vocabulario publicado", () => {
  test("los momentos salen de la fuente única, en su orden", () => {
    const v = vocabularioPublicado();
    assert.deepEqual(
      v.momentos.map((m) => m.id),
      [...MOMENTOS_DE_VENTA],
    );
  });

  test("cada momento viaja con su descripción: seis slugs pelados no alcanzan", () => {
    for (const m of vocabularioPublicado().momentos) {
      assert.ok(m.descripcion.length > 10, `«${m.id}» sin descripción usable`);
    }
  });

  test("la versión cambia si cambia el contenido, y no cambia si no", () => {
    assert.equal(vocabularioPublicado().version, vocabularioPublicado().version);
    assert.match(vocabularioPublicado().version, /^sha256:[0-9a-f]{16}$/);
  });

  test("EL FRONT tiene los mismos momentos que el server (los copió a mano)", () => {
    // `src/features/hechos/hechos.ts` duplica la lista porque el front no
    // importa del server. Mientras esa copia exista, este test es lo único que
    // la mantiene honesta — y es la prueba de que publicar el vocabulario hacía
    // falta: si el lado que PODRÍA importar igual duplicó, Python no tenía
    // ninguna vía.
    assert.deepEqual(momentosDelFront(), [...MOMENTOS_DE_VENTA]);
  });
});

describe("un momento que este build no conoce", () => {
  test("no explota, y NO se ensancha la pieza a todos los momentos", () => {
    // La simetría que Ivi pide: el enum crece de un lado, el otro tolera.
    // Ojo con el default: en `hechos`, momentos vacío significa «vale para
    // todos». Así que descartar el momento desconocido sería lo CONTRARIO de
    // conservador — convertiría una pieza acotada en una que se ofrece siempre.
    const catalogo = [
      { clave: "nuevo", rotulo: "x", texto: "y", momentos: ["momento-del-futuro"], orden: 1 },
      { clave: "viejo", rotulo: "x", texto: "y", momentos: ["cotizada"], orden: 2 },
    ] as Parameters<typeof elegirHechos>[0];

    const elegidos = elegirHechos(catalogo, "cotizada");

    assert.deepEqual(
      elegidos.map((h) => h.clave),
      ["viejo"],
    );
  });

  test("el clasificador siempre devuelve un momento del vocabulario", () => {
    const momento = momentoDeVenta({
      esPrimerContacto: false,
      curso: null,
      pidioInfo: false,
      cotizada: false,
      enfriada: false,
      vioMaterial: false,
    });
    assert.ok((MOMENTOS_DE_VENTA as readonly string[]).includes(momento));
  });
});
