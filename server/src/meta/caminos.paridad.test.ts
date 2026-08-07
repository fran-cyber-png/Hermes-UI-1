import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FUENTE, interpretar } from "../webhook/metaPayload.js";

/**
 * EL CANDADO ENTRE LOS DOS CAMINOS QUE ESCRIBEN LA MISMA FILA.
 *
 * Un comentario de FB/IG o un DM de Messenger puede entrar por el **polling**
 * (`meta/interactionsIngestor.ts`, el único que existía hasta el 7-ago-2026) o
 * por el **webhook** (`webhook/meta.ts`, en vivo). Los dos escriben en `events` +
 * `interactions`, y su convivencia sin duplicar depende de UN acuerdo:
 *
 *     el MISMO `source` y el MISMO `external_id` para el mismo hecho.
 *
 * Si alguien renombra `meta_comment_fb` de un solo lado, el mismo comentario
 * entra DOS VECES —una por cada camino— y en la cola aparece duplicado. No hay
 * error, no hay log: la clave `(source, external_id)` es distinta, así que el
 * `onConflictDoNothing` deja pasar los dos.
 *
 * Este archivo LEE EL ARCHIVO del polling y falla si los `source` divergen — el
 * mismo mecanismo que `whatsapp/limitesMedia.paridad.test.ts`, que lee el
 * archivo del front. Es feo y es lo único que atrapa una divergencia entre dos
 * módulos que no se importan.
 */

const ingestor = readFileSync(
  fileURLToPath(new URL("./interactionsIngestor.ts", import.meta.url)),
  "utf8",
);

describe("el polling y el webhook escriben con el MISMO vocabulario", () => {
  test("los tres `source` del webhook son los que el polling ya escribía", () => {
    for (const source of Object.values(FUENTE)) {
      assert.ok(
        ingestor.includes(`guardar("${source}"`),
        `el webhook escribe source="${source}" y el polling no lo usa en ninguna llamada a guardar()`,
      );
    }
  });

  test("el polling no escribe ningún `source` que el webhook desconozca", () => {
    const enElPolling = [...ingestor.matchAll(/guardar\(\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(enElPolling.length >= 3, "no se encontraron las llamadas a guardar() del polling");
    const conocidos = new Set<string>(Object.values(FUENTE));
    for (const source of enElPolling) {
      assert.ok(
        conocidos.has(source),
        `el polling escribe source="${source}" y el webhook no lo produce: ` +
          `ese canal solo va a entrar por el script manual`,
      );
    }
  });

  /**
   * LOS DOS CAMINOS USAN LA MISMA FUNCIÓN DE ESCRITURA. Si el polling volviera a
   * armarse su propio `insert`, podría calcular el `external_id` distinto —o
   * dejar de escribir `events` primero— y el acuerdo de arriba dejaría de
   * alcanzar para garantizar nada.
   */
  test("el polling escribe con `guardarInteraccion`, no con un insert propio", () => {
    assert.ok(
      ingestor.includes("guardarInteraccion"),
      "el polling dejó de usar la función compartida de escritura",
    );
    assert.ok(
      !/\.insert\(\s*interactions\s*\)/.test(ingestor),
      "el polling volvió a tener su propio insert a `interactions`",
    );
  });
});

describe("la forma de la fila es la misma por los dos caminos", () => {
  /**
   * Las columnas que la cola LEE de `interactions`. Si el webhook dejara alguna
   * afuera, la fila entraría con el default del schema y el defecto se vería en
   * la pantalla, no acá: `direccion` cae en `'entrante'`, así que **nuestra
   * propia respuesta se contaría como deuda del lead**.
   */
  test("un mensaje trae siempre direccion y autor: el default de la tabla mentiría", () => {
    const [item] = interpretar({
      object: "page",
      entry: [
        {
          id: "142062936237878",
          time: 1754600000000,
          messaging: [
            {
              sender: { id: "142062936237878" },
              recipient: { id: "psid-1" },
              timestamp: 1754599900000,
              message: { mid: "m_1", text: "te paso la info", is_echo: true },
            },
          ],
        },
      ],
    });
    assert.equal(item.proyeccion.direccion, "saliente");
    assert.equal(item.proyeccion.autor, "pagina");
  });

  test("toda proyección trae las claves que la cola necesita", () => {
    const cuerpos = [
      {
        object: "page",
        entry: [
          {
            id: "p1",
            time: 1754600000000,
            changes: [
              {
                field: "feed",
                value: { item: "comment", verb: "add", comment_id: "c1", created_time: 1754599000 },
              },
            ],
          },
        ],
      },
      {
        object: "instagram",
        entry: [
          { id: "ig1", time: 1754600000000, changes: [{ field: "comments", value: { id: "ic1" } }] },
        ],
      },
      {
        object: "page",
        entry: [
          {
            id: "p1",
            time: 1754600000000,
            messaging: [
              { sender: { id: "s1" }, timestamp: 1754599500000, message: { mid: "m1", text: "a" } },
            ],
          },
        ],
      },
    ];

    for (const cuerpo of cuerpos) {
      const [item] = interpretar(cuerpo);
      assert.ok(item, `no se interpretó ${JSON.stringify(cuerpo).slice(0, 60)}`);
      for (const clave of [
        "externalId",
        "canal",
        "tipo",
        "personaId",
        "personaNombre",
        "texto",
        "pageId",
        "contextoId",
        "contextoTexto",
        "occurredAt",
      ]) {
        assert.ok(clave in item.proyeccion, `falta ${clave} en ${item.source}`);
      }
      assert.ok(item.proyeccion.externalId.length > 0, "external_id vacío: no hay idempotencia");
      assert.ok(item.proyeccion.pageId.length > 0, "page_id vacío");
      assert.equal(Number.isNaN(item.proyeccion.occurredAt.getTime()), false);
    }
  });
});
