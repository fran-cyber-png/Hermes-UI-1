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
 */

const CON = (supervisores: string) => ({ HERMES_SUPERVISORES: supervisores }) as NodeJS.ProcessEnv;

test("el supervisor ve todo: sin recorte", () => {
  const r = recorteDelDashboard("ventas10@grupogoberna.com", CON("ventas10@grupogoberna.com,alan"));
  assert.equal(r.supervisor, true);
  assert.equal(r.soloAsignadasA, null);
});

test("quien no es supervisor queda acotado a lo suyo", () => {
  const r = recorteDelDashboard("ventas11@grupogoberna.com", CON("ventas10@grupogoberna.com,alan"));
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "ventas11@grupogoberna.com");
});

/**
 * 🔴 LA GRAFÍA. En producción el mismo humano tiene dos: Cerberus empuja `Luz` y
 * ella entra al login como `luz`. El `vendedoraId` del token es lo que se TIPEÓ,
 * así que un supervisor configurado con otra mayúscula dejaría de serlo **sin un
 * solo síntoma**: vería su propia pantalla recortada y leería «no me asignaron
 * nada», que es exactamente la conclusión equivocada.
 */
test("ser supervisor no depende de las mayúsculas con que se tipeó el usuario", () => {
  const r = recorteDelDashboard("ventas10@GRUPOGOBERNA.com", CON("Ventas10@grupogoberna.com"));
  assert.equal(r.supervisor, true);
});

test("los espacios de más en la variable no le sacan el rol a nadie", () => {
  const r = recorteDelDashboard("alan", CON(" ventas10@grupogoberna.com , alan "));
  assert.equal(r.supervisor, true);
});

/**
 * FAIL-CLOSED, heredado del padrón (ADR 0035): sin la variable NADIE es
 * supervisor. La alternativa —«sin configurar, todos ven todo»— convierte una
 * config que falta en la fuga que este frente vino a cerrar, y es el fallo que
 * nadie investiga porque se ve como que funciona.
 */
test("sin HERMES_SUPERVISORES nadie es supervisor: todas ven solo lo suyo", () => {
  const r = recorteDelDashboard("luz", {} as NodeJS.ProcessEnv);
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "luz");
});

test("con la variable vacía tampoco: una cadena en blanco no es una lista", () => {
  assert.equal(recorteDelDashboard("luz", CON("")).supervisor, false);
  assert.equal(recorteDelDashboard("luz", CON("  ,  ")).supervisor, false);
});

/**
 * Un token sin vendedora no llega hasta acá (`requiereVendedora`), pero si
 * llegara **no puede ver todo**: queda con un recorte vacío, que en SQL no
 * matchea ninguna clave. Fail-closed hasta el final.
 */
test("sin vendedora en el token: recorte vacío, nunca «todas»", () => {
  const r = recorteDelDashboard(undefined, CON("alan"));
  assert.equal(r.supervisor, false);
  assert.equal(r.soloAsignadasA, "");
});
