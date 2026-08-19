import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TODO EL QUE ESCRIBE EN `interactions` TIENE QUE LLENAR LOS PREDICADOS.
 *
 * 🔴 **El plan de este frente decía «el único escritor», y son DOS**:
 * `meta/proyectarInteraccion.ts` (comentarios de FB/IG y DMs de Messenger) y
 * `whatsapp/repositorioDrizzle.ts` (los mensajes de WhatsApp, o sea el 100 % de
 * las filas que la cola agrupa). Llenar sólo el primero hubiera dejado la
 * materialización sin efecto sobre el camino que importa, **y verde en todos los
 * tests**: el regex de respaldo cubre lo que falte, así que el síntoma no es un
 * error sino que la cola sigue costando lo mismo.
 *
 * Por eso el candado no nombra los archivos que hay hoy: busca **cualquiera** que
 * inserte en `interactions` y exige que en el mismo archivo aparezca
 * `predicadosDelTexto`. Un tercer escritor nace con este test rojo.
 *
 * ⚠️ **`pruebas/sembrar.ts` está exceptuado a propósito, y no es comodidad.** Los
 * ~40 `.test.db.ts` del repo siembran con él; dejando las columnas en `NULL`, esa
 * suite entera corre por el **regex de respaldo** y es la prueba de que el
 * fallback contesta lo de siempre. El camino de la columna llena lo cubre
 * `predicadosMaterializados.paridad.test.db.ts`, que la llena explícitamente.
 *
 * Mismo molde que `meta/caminos.paridad.test.ts` (los dos caminos de ingesta) y
 * `limitesMedia.paridad.test.ts`: leer el árbol es la única forma de atrapar al
 * archivo que todavía no existe.
 */

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/** Los que insertan en `interactions` sin ser escritores de producción. */
const EXCEPCIONES = ["pruebas/sembrar.ts"];

function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) fuentes(ruta, acumulado);
    else if (entrada.name.endsWith(".ts") && !entrada.name.includes(".test.")) acumulado.push(ruta);
  }
  return acumulado;
}

describe("los escritores de `interactions` llenan los predicados del texto", () => {
  const archivos = fuentes(RAIZ);

  test("el árbol se pudo leer (si no, este candado pasa por vacío)", () => {
    assert.ok(archivos.length > 200, `sólo ${archivos.length} fuentes: la raíz está mal`);
  });

  test("cada `.insert(interactions)` de producción corre `predicadosDelTexto`", () => {
    const escritores = archivos.filter((ruta) => readFileSync(ruta, "utf8").includes(".insert(interactions)"));
    assert.ok(escritores.length >= 2, "esperaba al menos los dos escritores conocidos");

    const relativos = escritores.map((r) => r.slice(RAIZ.length));
    assert.ok(
      relativos.includes("meta/proyectarInteraccion.ts"),
      "se movió el escritor de Meta: revisá este candado antes de tocarlo",
    );
    assert.ok(
      relativos.includes("whatsapp/repositorioDrizzle.ts"),
      "se movió el escritor de WhatsApp: revisá este candado antes de tocarlo",
    );

    for (const ruta of escritores) {
      const relativo = ruta.slice(RAIZ.length);
      if (EXCEPCIONES.includes(relativo)) continue;
      assert.ok(
        // La LLAMADA, no el import: con `includes("predicadosDelTexto")` a secas,
        // borrar la línea que la invoca y dejar el import pasaba en verde —
        // verificado poniéndolo en rojo antes de arreglarlo.
        readFileSync(ruta, "utf8").includes("predicadosDelTexto("),
        `${relativo} escribe en interactions y no llena los predicados del texto: ` +
          "esas filas van a pagar regex en cada lectura de la cola, sin un solo error",
      );
    }
  });
});
