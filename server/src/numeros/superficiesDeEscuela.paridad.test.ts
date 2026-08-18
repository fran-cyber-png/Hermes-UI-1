import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PREFIJOS_VEDADOS_A_CAMPANA, esSuperficieDeEscuela } from "./campana.js";

/**
 * EL CANDADO DE LAS CUATRO SUPERFICIES — que la lista y el montaje no se separen.
 *
 * 🔴 **El modo de fallar que esto atrapa no da error ni log.** `PREFIJOS_VEDADOS_A_CAMPANA`
 * es una lista de strings y `index.ts` es donde el candado se monta de verdad: agregar
 * un prefijo a la lista sin montar `deLaEscuela` en su router deja la superficie
 * ABIERTA mientras el nombre está escrito en el módulo de la frontera — o sea, la
 * peor combinación, porque quien lea la lista va a creer que está cubierta.
 *
 * Se lee el archivo en vez de importarlo a propósito: `index.ts` levanta la app
 * entera (base, transporte, webhooks) y no se puede importar desde un test puro.
 * Es el mismo recurso que `limitesMedia.paridad.test.ts` (#37).
 */
const INDEX = readFileSync(
  fileURLToPath(new URL("../index.ts", import.meta.url)),
  "utf8",
);

test("todo prefijo vedado a campaña está montado con el candado en index.ts", () => {
  for (const prefijo of PREFIJOS_VEDADOS_A_CAMPANA) {
    const montaje = new RegExp(
      `app\\.use\\(\\s*"${prefijo.replace(/\//g, "\\/")}"\\s*,\\s*deLaEscuela\\s*,`,
    );
    assert.match(
      INDEX,
      montaje,
      `«${prefijo}» está en PREFIJOS_VEDADOS_A_CAMPANA pero su router NO se monta con ` +
        `deLaEscuela: la lista promete una frontera que el server no aplica`,
    );
  }
});

test("el candado no se monta sobre rutas que la lista no declara", () => {
  // La otra mitad: un `deLaEscuela` de más le cortaría una superficie de la
  // Escuela a alguien de campaña sin que la lista —que es lo que se lee para
  // entender la frontera— diga que esa ruta está adentro.
  const montados = [...INDEX.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*deLaEscuela\s*,/g)].map((m) => m[1]);
  assert.equal(montados.length, PREFIJOS_VEDADOS_A_CAMPANA.length);
  for (const ruta of montados) {
    assert.ok(
      (PREFIJOS_VEDADOS_A_CAMPANA as readonly string[]).includes(ruta),
      `«${ruta}» se monta con el candado y no está en PREFIJOS_VEDADOS_A_CAMPANA`,
    );
  }
});

test("esSuperficieDeEscuela cubre las subrutas, no sólo el prefijo exacto", () => {
  // `/api/notas/por-link/:token` tiene que caer adentro sin enumerarlo.
  assert.equal(esSuperficieDeEscuela("/api/notas"), true);
  assert.equal(esSuperficieDeEscuela("/api/notas/por-link/abc"), true);
  assert.equal(esSuperficieDeEscuela("/api/espacios/3/miembros"), true);
});

test("🔴 no matchea un prefijo que sólo COMPARTE el comienzo", () => {
  // Sin el `/` del final, `/api/notasimportantes` entraría por parecido — y al
  // revés, una ruta nueva llamada así quedaría vedada sin que nadie lo decidiera.
  assert.equal(esSuperficieDeEscuela("/api/notasimportantes"), false);
  assert.equal(esSuperficieDeEscuela("/api/correosmasivos"), false);
});

test("lo que no es superficie de la Escuela pasa", () => {
  assert.equal(esSuperficieDeEscuela("/api/conversaciones"), false);
  assert.equal(esSuperficieDeEscuela("/api/whatsapp/enviar"), false);
  assert.equal(esSuperficieDeEscuela("/"), false);
});
