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
 * escriba en `interactions` —por drizzle o por SQL crudo— y exige que en el mismo
 * archivo se LLAME a `predicadosDelTexto`. Un tercer escritor nace con este test
 * rojo. ⚠️ Lo que se lee es el archivo **sin comentarios ni cadenas**
 * (`codigoDe`): una llamada comentada no llena una sola fila.
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

/**
 * EL ARCHIVO SIN COMENTARIOS — y esto NO es prolijidad.
 *
 * 🔴 Verificado poniéndolo en rojo: con el texto crudo, **COMENTAR la llamada
 * dejaba este candado en VERDE**, porque la línea comentada sigue conteniendo
 * `predicadosDelTexto(`. O sea que la forma más natural de desactivar algo
 * —anteponerle `//` para probar una cosa y olvidarse— era justo la que este test
 * no veía. Es la misma clase de agujero que su versión anterior tenía con el
 * `import` suelto, un escalón más adentro.
 *
 * ⚠️ **Las CADENAS se CONSERVAN, y descartarlas fue un intento fallido que vale
 * la pena dejar escrito**: parecía higiene («mencionar la tabla en un texto no es
 * escribirla»), pero el SQL crudo VIVE adentro de un template — un
 * `db.execute(sql\`INSERT INTO interactions …\`)` desaparecía entero y el escritor
 * futuro volvía a esquivar el candado. Se prefiere el falso positivo: a un archivo
 * que nombra esa escritura en una cadena se le va a exigir la llamada, y eso falla
 * hacia EXIGIR, que es el lado correcto para un candado.
 *
 * El escáner distingue cadena de comentario en vez de recortar desde el primer
 * `//`, porque `'https://…'` aparece en este árbol y ese recorte se comería el
 * resto de la línea.
 */
function sinComentarios(fuente: string): string {
  let salida = "";
  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    const par = fuente.slice(i, i + 2);
    if (par === "//") {
      while (i < fuente.length && fuente[i] !== "\n") i++;
      continue;
    }
    if (par === "/*") {
      i += 2;
      while (i < fuente.length && fuente.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // La cadena se copia TAL CUAL: acá adentro puede vivir un INSERT.
      const cierre = c;
      salida += c;
      i++;
      while (i < fuente.length && fuente[i] !== cierre) {
        if (fuente[i] === "\\") {
          salida += fuente.slice(i, i + 2);
          i += 2;
          continue;
        }
        salida += fuente[i];
        i++;
      }
      salida += cierre;
      i++;
      continue;
    }
    salida += c;
    i++;
  }
  return salida;
}

/** El código de un archivo, sin lo que no se ejecuta. */
function codigoDe(ruta: string): string {
  return sinComentarios(readFileSync(ruta, "utf8"));
}

/**
 * ⚠️ **Las DOS formas de escribir cuentan.** El drizzle (`.insert(interactions)`)
 * y el SQL crudo — que en este repo no es hipotético: `cola/backfillPredicados.ts`
 * escribe con `UPDATE interactions` a mano. Un escritor futuro que use
 * `db.execute(sql\`INSERT INTO interactions …\`)` esquivaba el candado entero.
 */
function esEscritor(codigo: string): boolean {
  return codigo.includes(".insert(interactions)") || /insert\s+into\s+interactions/i.test(codigo);
}

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

  test("cada escritura en `interactions` de producción corre `predicadosDelTexto`", () => {
    const escritores = archivos.filter((ruta) => esEscritor(codigoDe(ruta)));
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
        // La LLAMADA VIVA. Dos escalones, los dos verificados en rojo: con
        // `includes("predicadosDelTexto")` a secas alcanzaba con dejar el import;
        // sobre el texto crudo alcanzaba con COMENTAR la llamada. Por eso se mira
        // el código sin comentarios (`codigoDe`).
        codigoDe(ruta).includes("predicadosDelTexto("),
        `${relativo} escribe en interactions y no llena los predicados del texto: ` +
          "esas filas van a pagar regex en cada lectura de la cola, sin un solo error",
      );
    }
  });
});
