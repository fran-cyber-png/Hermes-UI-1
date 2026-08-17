import { test } from "node:test";
import assert from "node:assert/strict";
import { veredictoDelPreflight, type FilaPreflight } from "./preflightFrontera.js";

/**
 * EL VEREDICTO DEL PREFLIGHT, INTERROGADO SIN BASE.
 *
 * La regla que decide «se despliega o no» tiene que poder probarse sin montar
 * nada: los escenarios que importan —alguien en cero, alguien arrastrando el
 * archivo entero, todas viendo lo mismo— son combinaciones de números, y armar
 * cada uno con siembra costaría tres tests con base para verificar una tabla de
 * verdad.
 */

const sana = (over: Partial<FilaPreflight> = {}): FilaPreflight => ({
  vendedoraId: "sindy",
  esSupervisora: false,
  total: 40,
  propias: 38,
  huerfanas: 2,
  ...over,
});

const UMBRALES = { maxHuerfanas: 500 };

test("una mesa sana pasa", () => {
  const v = veredictoDelPreflight(
    [sana(), sana({ vendedoraId: "luz", total: 60, propias: 58, huerfanas: 2 })],
    UMBRALES,
  );
  assert.equal(v.ok, true, v.problemas.join(" · "));
});

test("🔴 alguien en CERO frena el deploy", () => {
  const v = veredictoDelPreflight(
    [sana(), sana({ vendedoraId: "tracy", total: 0, propias: 0, huerfanas: 0 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /tracy/);
  assert.match(v.problemas.join(" "), /VACÍA/);
});

/**
 * ⚠️ Una supervisora en cero es un problema distinto y por eso también frena:
 * ve todo por definición, así que cero significa que la cola entera está vacía y
 * la medición de todas las demás no vale nada.
 */
test("una SUPERVISORA en cero también frena: la medición entera queda invalidada", () => {
  const v = veredictoDelPreflight(
    [sana({ vendedoraId: "jefa", esSupervisora: true, total: 0, propias: 0, huerfanas: 0 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
});

test("🔴 arrastrar el archivo de las líneas muertas frena el deploy por el OTRO lado", () => {
  const v = veredictoDelPreflight(
    [sana({ total: 2900, propias: 25, huerfanas: 2875 }), sana({ vendedoraId: "luz", total: 60 })],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /2875 huérfanas/);
});

/**
 * 🔴 EL DETECTOR DE «FRONTERA APAGADA», y es el que un preflight ingenuo no
 * tiene: cada fila por separado se ve perfectamente razonable.
 */
test("si TODAS las vendedoras ven exactamente lo mismo, la frontera no se está aplicando", () => {
  const v = veredictoDelPreflight(
    [
      sana({ vendedoraId: "sindy", total: 300, propias: 20, huerfanas: 280 }),
      sana({ vendedoraId: "luz", total: 300, propias: 250, huerfanas: 50 }),
    ],
    UMBRALES,
  );
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /ven EXACTAMENTE lo mismo/);
});

/**
 * ⚠️ El control del test de arriba: con UNA sola vendedora la coincidencia no
 * significa nada, y disparar ahí volvería el preflight inservible justo en la
 * situación más común (una persona de guardia).
 */
test("con una sola vendedora, «todas ven lo mismo» no dispara", () => {
  const v = veredictoDelPreflight([sana(), sana({ vendedoraId: "jefa", esSupervisora: true, total: 40 })], UMBRALES);
  assert.equal(v.ok, true, v.problemas.join(" · "));
});

test("sin filas el preflight FALLA: no verificó nada", () => {
  const v = veredictoDelPreflight([], UMBRALES);
  assert.equal(v.ok, false);
  assert.match(v.problemas.join(" "), /no se midió a NADIE/);
});

test("el techo de huérfanas se puede bajar, y entonces sí dispara", () => {
  const filas = [sana({ huerfanas: 40, total: 78 }), sana({ vendedoraId: "luz", total: 60 })];
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 500 }).ok, true);
  assert.equal(veredictoDelPreflight(filas, { maxHuerfanas: 10 }).ok, false);
});
