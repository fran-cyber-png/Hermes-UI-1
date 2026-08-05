import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOGO_EVENTOS, TIPOS_EVENTO, TOPE_NOTA } from "./catalogo.js";

/**
 * EL CANDADO ENTRE LOS DOS CATÁLOGOS DE EVENTOS.
 *
 * `src/features/eventos/eventos.ts` duplica el vocabulario a mano, porque el
 * popover tiene que poder pintarse sin pedirle al server seis strings
 * estáticos. Mientras esa copia exista, ESTE test es lo único que la mantiene
 * honesta — es el mismo mecanismo que ya cruza `src/features/hechos/hechos.ts`
 * con `MOMENTOS_DE_VENTA`, y por el mismo motivo: la desincronización no rompe
 * nada visible, hace que la pantalla ofrezca una cosa y el server valide otra.
 *
 * El caso concreto que atrapa: si acá se agrega `pidio_factura` con
 * `exigeNota: true` y el front no se entera, la vendedora manda el evento sin
 * texto, el server lo rechaza y la pantalla dice «no se pudo registrar» sin
 * poder explicar qué falta — porque el front no sabe que ese tipo exige nota.
 */

const RUTA_FRONT = fileURLToPath(
  new URL("../../../src/features/eventos/eventos.ts", import.meta.url),
);

function fuenteDelFront(): string {
  return readFileSync(RUTA_FRONT, "utf8");
}

/** Los ids del array `TIPOS_EVENTO` del front, en su orden. */
function tiposDelFront(): string[] {
  const fuente = fuenteDelFront();
  const bloque = /export const TIPOS_EVENTO = \[([\s\S]*?)\] as const;/.exec(fuente);
  assert.ok(bloque, `no encontré TIPOS_EVENTO en ${RUTA_FRONT}`);
  return [...(bloque[1] as string).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

/**
 * Las definiciones del front, leídas del texto.
 *
 * Se parsea en vez de importar porque el server no compila el árbol del front
 * (otro tsconfig, otro build). Es la misma técnica de `catalogo/vocabulario.test.ts`.
 */
function definicionesDelFront(): Record<string, { rotulo: string; pideCurso: boolean; exigeNota: boolean }> {
  const fuente = fuenteDelFront();
  const bloque = /export const CATALOGO_EVENTOS: Record<TipoEvento, DefinicionEvento> = \{([\s\S]*?)\n\};/.exec(
    fuente,
  );
  assert.ok(bloque, `no encontré CATALOGO_EVENTOS en ${RUTA_FRONT}`);

  const salida: Record<string, { rotulo: string; pideCurso: boolean; exigeNota: boolean }> = {};
  const entradas = (bloque[1] as string).matchAll(
    /(\w+):\s*\{[\s\S]*?rotulo:\s*'([^']*)'[\s\S]*?pideCurso:\s*(true|false)[\s\S]*?exigeNota:\s*(true|false)[\s\S]*?\}/g,
  );
  for (const m of entradas) {
    salida[m[1] as string] = {
      rotulo: m[2] as string,
      pideCurso: m[3] === "true",
      exigeNota: m[4] === "true",
    };
  }
  return salida;
}

describe("el catálogo de eventos, de los dos lados", () => {
  test("el front ofrece EXACTAMENTE los mismos tipos, en el mismo orden", () => {
    // El orden importa: es el orden en que la vendedora ve los botones, y una
    // captura de evidencia contra un orden y un server contra otro no se
    // pueden comparar.
    assert.deepEqual(tiposDelFront(), [...TIPOS_EVENTO]);
  });

  test("cada tipo dice lo MISMO de los dos lados: rótulo, pideCurso y exigeNota", () => {
    const front = definicionesDelFront();
    for (const t of TIPOS_EVENTO) {
      const f = front[t];
      assert.ok(f, `«${t}» no está definido en el front`);
      assert.equal(f.rotulo, CATALOGO_EVENTOS[t].rotulo, `«${t}»: el rótulo difiere`);
      assert.equal(
        f.pideCurso,
        CATALOGO_EVENTOS[t].pideCurso,
        `«${t}»: pideCurso difiere — el popover abriría (o no) el buscador de curso al revés que el server`,
      );
      assert.equal(
        f.exigeNota,
        CATALOGO_EVENTOS[t].exigeNota,
        `«${t}»: exigeNota difiere — la pantalla dejaría mandar algo que el server rechaza sin poder explicarlo`,
      );
    }
  });

  test("el tope del comentario es el mismo: recortar distinto es perder texto en silencio", () => {
    const m = /export const TOPE_NOTA = (\d+);/.exec(fuenteDelFront());
    assert.ok(m, `no encontré TOPE_NOTA en ${RUTA_FRONT}`);
    assert.equal(Number(m[1]), TOPE_NOTA);
  });
});
