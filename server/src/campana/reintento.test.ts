import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clasificarFallo, esperaDeReintento, REINTENTOS_MAXIMOS } from "./reintento.js";

/** El caso real: la campaña del Foro se frenó en el 446 de 999 con esto. */
test("«fetch failed» es transitorio — es el que frenó la campaña del Foro", () => {
  assert.equal(clasificarFallo("fetch failed"), "transitorio");
  assert.equal(clasificarFallo("Error al enviar: fetch failed"), "transitorio");
  assert.equal(clasificarFallo("FETCH FAILED"), "transitorio");
});

test("el tope por usuario sigue siendo su propia clase, no una falla", () => {
  assert.equal(clasificarFallo("(#131049) This message was not delivered"), "tope_por_usuario");
});

test("los cortes de socket y de DNS son transitorios", () => {
  for (const m of [
    "socket hang up",
    "read ECONNRESET",
    "connect ETIMEDOUT 157.240.1.1:443",
    "getaddrinfo EAI_AGAIN graph.facebook.com",
    "network error",
    "The operation was aborted",
  ]) {
    assert.equal(clasificarFallo(m), "transitorio", m);
  }
});

/**
 * 🔴 EL DEFECTO QUE ESTE TEST MATA. Todos los motivos de este script llevan un
 * teléfono adentro, y buscar «500» a secas haría transitorio a cualquier
 * rechazo cuyo número contenga esos dígitos — justo lo que el freno existe para
 * no dejar pasar.
 */
test("un teléfono con 500/502 adentro NO vuelve transitorio a un rechazo", () => {
  assert.equal(
    clasificarFallo("51950012345 — (#132000) Template param count mismatch"),
    "definitivo",
  );
  assert.equal(clasificarFallo("51502339941 — plantilla pausada por calidad"), "definitivo");
});

test("un 5xx de Graph, nombrado como tal, sí es transitorio", () => {
  assert.equal(clasificarFallo("HTTP 503 de graph.facebook.com"), "transitorio");
  assert.equal(clasificarFallo("status 502 Bad Gateway"), "transitorio");
});

/**
 * El default protege el número: lo que no reconocemos se mira, no se reintenta.
 * Frenar de más cuesta reanudar a mano; seguir de más puede costar la línea.
 */
test("lo desconocido es DEFINITIVO, nunca transitorio", () => {
  assert.equal(clasificarFallo("algo que nadie previó"), "definitivo");
  assert.equal(clasificarFallo(""), "definitivo");
  assert.equal(clasificarFallo("(#131047) Re-engagement message"), "definitivo");
});

test("los rechazos de política de Meta frenan la corrida entera", () => {
  assert.equal(clasificarFallo("(#132012) Parameter format does not match"), "definitivo");
  assert.equal(clasificarFallo("(#131026) Message undeliverable"), "definitivo");
  assert.equal(clasificarFallo("(#368) temporarily blocked for policies violations"), "definitivo");
});

test("el backoff crece y tiene techo: si no volvió en 30s no es un hipo", () => {
  assert.equal(esperaDeReintento(1), 5_000);
  assert.equal(esperaDeReintento(2), 10_000);
  assert.equal(esperaDeReintento(3), 20_000);
  assert.equal(esperaDeReintento(4), 30_000);
  assert.equal(esperaDeReintento(9), 30_000);
});

test("los reintentos son pocos: un corte que dura tres intentos no es un hipo", () => {
  assert.ok(REINTENTOS_MAXIMOS >= 2 && REINTENTOS_MAXIMOS <= 5);
});
