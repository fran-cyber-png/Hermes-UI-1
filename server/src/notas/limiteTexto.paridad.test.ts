import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIMITE_TEXTO } from "./notas.js";

/**
 * EL CANDADO ENTRE LOS DOS `LIMITE_TEXTO`.
 *
 * `src/features/notas/notas.ts` tiene su propia copia del número porque redacta
 * el fallo cuando el server no explicó por qué rechazó (`guardado.ts`:
 * *«No se guardó: pasa de los N caracteres»*).
 *
 * ══ POR QUÉ ESTO NECESITA UN TEST Y NO UN COMENTARIO ════════════════════════
 *
 * Ya se desincronizaron una vez, el mismo día: al subir el tope de 2.000 a 20.000
 * en el server (ADR 0047), el front siguió diciendo 2.000. Y el defecto que eso
 * produce es de los peores de encontrar, porque **no rompe nada**: la vendedora
 * se pasa del tope viejo, el server acepta el guardado sin chistar, y si algún
 * día algo falla por otro motivo la pantalla le explica que «pasa de los 2.000»
 * — un número que ya no existe en ningún lado. El mensaje SUENA correcto.
 *
 * Es el mismo mecanismo que cruza `limitesMedia`, `eventos` y `hechos` con sus
 * copias del front, y por el mismo motivo (#37): dos lugares que dicen lo mismo
 * necesitan algo que los obligue a seguir diciéndolo.
 */

const RUTA_FRONT = fileURLToPath(new URL("../../../src/features/notas/notas.ts", import.meta.url));

test("el LIMITE_TEXTO del front es el mismo que el del server", () => {
  const fuente = readFileSync(RUTA_FRONT, "utf8");

  // Se acepta el separador `_` de TS (`20_000`), que es como está escrito.
  const m = fuente.match(/export const LIMITE_TEXTO\s*=\s*([\d_]+)/);
  assert.ok(m, "no se encontró `export const LIMITE_TEXTO` en el front — ¿se renombró?");

  const delFront = Number(m![1].replace(/_/g, ""));
  assert.equal(
    delFront,
    LIMITE_TEXTO,
    `el front dice ${delFront} y el server ${LIMITE_TEXTO}: la pantalla explicaría el tope con un número que no rige`,
  );
});
