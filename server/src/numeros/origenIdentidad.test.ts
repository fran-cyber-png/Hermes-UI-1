import { test } from "node:test";
import assert from "node:assert/strict";
import { esIdentidadFederada } from "./origenIdentidad.js";

/**
 * QUIÉN PUEDE BORRAR A QUIÉN DEL MAPA DE LÍNEAS.
 *
 * Los casos no son inventados: son las grafías que hay hoy en `numero_vendedora`
 * y en `sesiones_cerberus` de producción.
 */
test("las identidades de Cerberus NO son federadas — su set declarativo las manda", () => {
  for (const id of ["luz", "Luz", "Usuario1", "ventas10@grupogoberna.com", "Walter", "Sindy"]) {
    assert.equal(esIdentidadFederada(id), false, `${id} es de Cerberus y su push la reemplaza`);
  }
});

test("🔴 una identidad de Centurión SÍ es federada: el push de Cerberus no la puede borrar", () => {
  // El caso medido: `centurion:betto.romero` la crea Centurión, Cerberus no la
  // conoce y jamás la manda en su set. Con el reemplazo a ciegas, el primer push
  // legítimo la borraba y devolvía al agente digital al 403, sin error y sin log.
  assert.equal(esIdentidadFederada("centurion:betto.romero"), true);
  assert.equal(esIdentidadFederada("centurion:zaida.trejo"), true);
});

test("la regla es el prefijo de origen, no una lista de sistemas conocidos", () => {
  // Un origen que todavía no existe ya queda protegido: no hay que acordarse de
  // agregarlo acá el día que aparezca, que es cómo se rompen estas listas.
  assert.equal(esIdentidadFederada("directorio:a1b2"), true);
  assert.equal(esIdentidadFederada("kanban:gianfranco"), true);
});

test("un correo no es una identidad federada — el arroba no es el prefijo", () => {
  // Es el falso positivo que este predicado tiene que NO cometer: media rueda de
  // reparto son correos, y tratarlos como federados haría que el push de Cerberus
  // dejara de poder sacarlos, que es justo lo que sí tiene que poder hacer.
  assert.equal(esIdentidadFederada("ventas14@grupogoberna.com"), false);
});
