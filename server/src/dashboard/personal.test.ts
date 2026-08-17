import { test } from "node:test";
import assert from "node:assert/strict";
import { recorteDelDashboard } from "./personal.js";

/**
 * DE QUIÉN ES EL DASHBOARD — la regla, sin base.
 *
 * Lo que se fija acá es lo que decide si el frente entero sirve o abre un
 * agujero: **quién ve todo**. Un `true` de más y una vendedora sigue viendo el
 * trabajo de las otras cuatro; un `false` de más y el supervisor se queda sin la
 * única pantalla desde la que se vigila lo que todavía no tiene dueño.
 *
 * ⚠️ **Esta función ya no lee el entorno**: recibe el ROL, que `cargarRol`
 * resuelve una vez por request. Lo que antes se probaba acá —la grafía `Luz` vs
 * `luz`, los espacios del CSV, el fail-closed sin variable— vive ahora donde se
 * decide, en `equipo/cascada.test.ts`; probarlo dos veces sería fijar dos veces
 * la misma regla y creer que hay dos candados.
 */

test("el supervisor ve todo: sin recorte", () => {
  const r = recorteDelDashboard("ventas10@grupogoberna.com", "supervisor");
  assert.equal(r.supervisor, true);
  assert.equal(r.soloAsignadasA, null);
});

/**
 * 🔴 EL ADMIN TAMBIÉN VE TODO, y esto es lo que se rompe si alguien escribe
 * `rol === 'supervisor'` en vez de preguntar si ALCANZA. El síntoma no sería un
 * error: sería que el admin abre un Dashboard de sus propias asignadas —que son
 * cero, porque nadie le reparte leads al admin— y «El negocio» le contesta 403.
 */
test("el admin ve todo igual que el supervisor: la escalera no tiene agujeros", () => {
  const r = recorteDelDashboard("alan", "admin");
  assert.equal(r.supervisor, true);
  assert.equal(r.soloAsignadasA, null);
});

test("quien no es supervisor queda acotado a lo suyo", () => {
  const r = recorteDelDashboard("ventas11@grupogoberna.com", "vendedora");
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "ventas11@grupogoberna.com");
});

/**
 * FAIL-CLOSED, heredado del padrón (ADR 0035): el rol que no se pudo resolver
 * llega como `vendedora` (ver `SIN_IDENTIDAD` en `equipo/cascada.ts`), así que el
 * default de esta función es el recorte y no la vista completa. La alternativa
 * —«ante la duda, todo»— convierte una config que falta o un blip de la base en
 * la fuga que este frente vino a cerrar.
 */
test("el rol por default recorta: ante la duda se ve MENOS, nunca más", () => {
  const r = recorteDelDashboard("luz", "vendedora");
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "luz");
});

/**
 * Un token sin vendedora no llega hasta acá (`requiereVendedora`), pero si
 * llegara **no puede ver todo**: queda con un recorte vacío, que en SQL no
 * matchea ninguna clave. Fail-closed hasta el final.
 */
test("sin vendedora en el token: recorte vacío, nunca «todas»", () => {
  const r = recorteDelDashboard(undefined, "vendedora");
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "");
});

/**
 * ⚠️ El id se conserva con la grafía que vino: la normalización vive en el SQL
 * (`clavesAsignadasSql` hace `lower(btrim())` de los dos lados). Reescribirla acá
 * rompería el cruce con lo que ya tiene filas escritas con la otra grafía.
 */
test("no reescribe la grafía del id, solo le saca los espacios", () => {
  assert.equal(recorteDelDashboard("  Luz  ", "vendedora").soloAsignadasA, "Luz");
});
