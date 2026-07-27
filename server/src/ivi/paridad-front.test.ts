import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CODIGO_ERROR_IVI, esReintentable, type CodigoErrorIvi } from "./cliente.js";

/**
 * #175 — QUE LAS DOS TABLAS DE `reintentable` NO PUEDAN VOLVER A DIVERGIR.
 *
 * Hay dos, y las dos tienen que existir:
 *
 *   `esReintentable()` acá ......... la que decide, con el estado HTTP a la vista
 *   `LECTURAS` en el front ......... el RESPALDO, para un 502 de un server viejo que
 *                                    todavía no manda el flag
 *
 * El defecto que esto cierra: el front re-derivaba el reintento de su tabla **siempre**, no
 * solo como respaldo, y esa tabla está indexada nada más que por `codigo`. Con `http_inesperado`
 * —el cajón de sastre donde caen el 404 permanente y el 500 transitorio— acertar los dos es
 * imposible sin el estado, así que la pantalla le negaba el botón a la vendedora mientras el
 * server decía `reintentable: true` al lado.
 *
 * Es la lección de #37 (la urgencia implementada dos veces) en versión chica. La diferencia con
 * #37: acá la duplicación **no se puede borrar** —el respaldo protege del server viejo—, así que
 * en vez de una sola implementación se fija la relación entre las dos.
 *
 * Se lee el front como TEXTO y no se importa, igual que `catalogo/vocabulario.test.ts`: son dos
 * builds distintos, y un test del server no puede depender del tsconfig de la app.
 */

const RUTA_FRONT = fileURLToPath(new URL("../../../src/features/ivi/errores.ts", import.meta.url));

/**
 * El `reintentable` que el front tiene escrito a mano para cada código.
 *
 * Parsea el bloque `LECTURAS` entrada por entrada. Si el bloque deja de existir o cambia de
 * forma, el test FALLA en vez de devolver un objeto vacío — un parser que no encuentra nada y
 * dice «todo bien» es exactamente el fallo silencioso que este archivo vino a evitar.
 */
function reintentablesDelFront(): Record<string, boolean> {
  const fuente = readFileSync(RUTA_FRONT, "utf8");
  const bloque = /const LECTURAS: Record<[\s\S]*?> = \{([\s\S]*?)\n\};/.exec(fuente);
  assert.ok(bloque, `no encontré el bloque LECTURAS en ${RUTA_FRONT}`);

  const tabla: Record<string, boolean> = {};
  // `codigo: {` … `reintentable: <bool>` … hasta el cierre de esa entrada.
  for (const m of (bloque[1] as string).matchAll(
    /^ {2}([a-z_]+): \{([\s\S]*?)^ {2}\},$/gm,
  )) {
    const codigo = m[1] as string;
    const cuerpo = m[2] as string;
    const valor = /reintentable: (true|false),/.exec(cuerpo);
    assert.ok(valor, `la entrada «${codigo}» del front no declara reintentable`);
    tabla[codigo] = valor[1] === "true";
  }

  assert.ok(
    Object.keys(tabla).length > 0,
    `parseé el bloque LECTURAS y no saqué ninguna entrada — el parser quedó viejo, no es que el front esté vacío`,
  );
  return tabla;
}

const CODIGOS = Object.values(CODIGO_ERROR_IVI) as CodigoErrorIvi[];

describe("`reintentable`: el server y el respaldo del front", () => {
  test("el front conoce EXACTAMENTE los mismos ocho códigos", () => {
    const front = reintentablesDelFront();
    assert.deepEqual(Object.keys(front).sort(), [...CODIGOS].sort());
  });

  test("SIN estado, las dos tablas dicen lo mismo — el respaldo no puede contradecir al server", () => {
    // Un server viejo no manda el flag, y tampoco manda el estado. Ese es el único escenario en
    // que la tabla del front decide, así que es exactamente ahí donde tiene que coincidir.
    const front = reintentablesDelFront();
    for (const codigo of CODIGOS) {
      assert.equal(
        front[codigo],
        esReintentable(codigo),
        `«${codigo}»: el front dice ${front[codigo]} y el server ${esReintentable(codigo)} — divergieron`,
      );
    }
  });

  test("`http_inesperado` SÍ depende del estado, y por eso el flag no es opcional", () => {
    // Si esto dejara de ser cierto, la tabla del front alcanzaría y el flag sobraría. Mientras
    // sea cierto, una tabla indexada solo por `codigo` está equivocada en la mitad de los casos.
    assert.equal(esReintentable(CODIGO_ERROR_IVI.HTTP_INESPERADO, 500), true, "el 500 de Ivi es transitorio");
    assert.equal(esReintentable(CODIGO_ERROR_IVI.HTTP_INESPERADO, 502), true, "el 502 de nginx es transitorio");
    assert.equal(esReintentable(CODIGO_ERROR_IVI.HTTP_INESPERADO, 404), false, "el 404 es «no lo desplegaron»");

    // Y el respaldo del front elige el conservador para los dos: nunca ofrece un botón de más.
    assert.equal(reintentablesDelFront()["http_inesperado"], false);
  });

  test("el front LEE el flag en vez de re-derivarlo — el defecto de #175, fijado", () => {
    const fuente = readFileSync(RUTA_FRONT, "utf8");
    assert.match(
      fuente,
      /err\.reintentable/,
      "`lecturaDeError` no mira `err.reintentable`: volvió a re-derivar el reintento de su propia tabla",
    );
  });

  test("y el flag sobrevive el borde de `api()`: si `ErrorApi` no lo lleva, nunca llega al front", () => {
    // El campo se perdía ACÁ, no en la pantalla: `api()` armaba el `ErrorApi` sin copiarlo.
    const cliente = readFileSync(
      fileURLToPath(new URL("../../../src/lib/datos/cliente.ts", import.meta.url)),
      "utf8",
    );
    assert.match(cliente, /readonly reintentable\?: boolean/, "`ErrorApi` no declara `reintentable`");
    assert.match(
      cliente,
      /typeof cuerpo\.reintentable === 'boolean'/,
      "`api()` no copia `reintentable` del cuerpo, o dejó de exigir que sea booleano",
    );
  });
});
