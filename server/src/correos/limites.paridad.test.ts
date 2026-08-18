import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOPE_CUERPO } from "./limites.js";

/**
 * EL CANDADO ENTRE LOS DOS `TOPE_CUERPO`.
 *
 * El front tiene su propia copia porque apaga el botón de Enviar y redacta el
 * motivo («El correo pasa de los 20.000 caracteres: sobran 5.000») antes de
 * tocar el server. La garantía sigue siendo el 400 de la ruta; lo del navegador
 * es que el aviso sea de la app y no un error anónimo después de escribir todo.
 *
 * ══ POR QUÉ ESTO ES UN TEST Y NO UN COMENTARIO ══════════════════════════════
 *
 * 🔴 Ya se desincronizaron una vez, con este mismo patrón y el mismo número: al
 * subir el tope de las notas de 2.000 a 20.000 (ADR 0047), el server cambió y el
 * front siguió diciendo 2.000. **No rompe nada** — y ése es el problema: la
 * pantalla explica el rechazo con una cifra que no rige en ningún lado, la frase
 * suena correcta, y nadie lo reporta como bug.
 *
 * Es el mismo mecanismo que cruza `limiteTexto`, `limitesMedia`, `eventos` y
 * `hechos` con sus copias del front, y por el mismo motivo (#37): dos lugares que
 * dicen lo mismo necesitan algo que los obligue a seguir diciéndolo.
 *
 * ⚠️ **No se cruza `TOPE_ASUNTO`**, y no es un olvido: el front no lo tiene. Si
 * algún día lo copia —para contar caracteres en la caja de asunto—, este archivo
 * es donde va su candado, con el mismo molde.
 */

const RUTA_FRONT = fileURLToPath(
  new URL("../../../src/features/correos/correos.ts", import.meta.url),
);

test("el TOPE_CUERPO del front es el mismo que el del server", () => {
  const fuente = readFileSync(RUTA_FRONT, "utf8");

  // Se acepta el separador `_` de TS (`20_000`), que es como está escrito de los
  // dos lados.
  const m = fuente.match(/export const TOPE_CUERPO\s*=\s*([\d_]+)/);
  assert.ok(m, "no se encontró `export const TOPE_CUERPO` en el front — ¿se renombró?");

  const delFront = Number(m![1].replace(/_/g, ""));
  assert.equal(
    delFront,
    TOPE_CUERPO,
    `el front dice ${delFront} y el server ${TOPE_CUERPO}: la pantalla explicaría el tope con un número que no rige`,
  );
});

/**
 * ⚠️ El front cuenta `campos.cuerpo.length` **sin recortar los bordes**, y el
 * server tiene que contar igual. Con un `trim()` de un solo lado, un cuerpo de
 * exactamente 20.000 caracteres más tres Enter al final pasaría de un lado y
 * rebotaría del otro: la pantalla diría que entra y el server que sobran tres.
 */
test("🔴 el front NO recorta antes de medir, así que el server tampoco puede", () => {
  const fuente = readFileSync(RUTA_FRONT, "utf8");

  assert.match(
    fuente,
    /campos\.cuerpo\.length\s*>\s*TOPE_CUERPO/,
    "el front cambió cómo mide el cuerpo: revisá que la ruta mida la misma cadena",
  );
  assert.doesNotMatch(
    fuente,
    /campos\.cuerpo\.trim\(\)\.length\s*>\s*TOPE_CUERPO/,
    "el front empezó a medir el cuerpo recortado: el borde exacto ya no es el mismo de los dos lados",
  );
});
