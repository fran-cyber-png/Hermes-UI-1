import assert from "node:assert/strict";
import test from "node:test";
import { esNombreDeVerdad } from "./nombre.js";

test("un nombre de persona se muestra", () => {
  assert.equal(esNombreDeVerdad("ventas11@grupogoberna.com", "Cielo Huambo"), true);
  assert.equal(esNombreDeVerdad("alex", "Alex Roldán"), true);
});

test("el relleno de la siembra NO es un nombre", () => {
  // Lo que `equipo/semilla.ts` guardó para las cuentas cuyo username es el correo.
  assert.equal(
    esNombreDeVerdad("ventas13@grupogoberna.com", "ventas13@grupogoberna.com"),
    false,
  );
});

test("el username capitalizado tampoco lo es — se compara normalizando los DOS lados", () => {
  // `Tracy` sobre `tracy`, `Luz` sobre `luz`: es la grafía del id, no un nombre.
  assert.equal(esNombreDeVerdad("tracy", "Tracy"), false);
  assert.equal(esNombreDeVerdad("luz", "Luz"), false);
  assert.equal(esNombreDeVerdad("ventas13@grupogoberna.com", "  VENTAS13@GRUPOGOBERNA.COM "), false);
});

test("vacío, espacios y ausente son lo mismo: no hay nombre", () => {
  assert.equal(esNombreDeVerdad("luz", ""), false);
  assert.equal(esNombreDeVerdad("luz", "   "), false);
  assert.equal(esNombreDeVerdad("luz", null), false);
  assert.equal(esNombreDeVerdad("luz", undefined), false);
});

test("un nombre que EMPIEZA con el username sigue siendo un nombre", () => {
  // El caso de Cerberus: `first_name = 'Tracy'`, `last_name` vacío, y mañana
  // alguien completa el apellido. Comparar por prefijo lo descartaría.
  assert.equal(esNombreDeVerdad("tracy", "Tracy Quispe"), true);
});
