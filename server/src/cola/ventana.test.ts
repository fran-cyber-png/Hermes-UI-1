import test from "node:test";
import assert from "node:assert/strict";
import { ventanaAbierta, ventanaCierraEn, ventanaRestanteMs, type ItemVentana } from "./ventana.js";
import { VENTANA_MENSAJE_HORAS, VENTANA_META_DIAS } from "./urgenciaSql.js";

const AHORA = new Date("2026-08-07T15:00:00Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const chat = (ultimoEntranteEn: Date | null, canal = "whatsapp"): ItemVentana => ({
  tipo: "mensaje",
  canal,
  ultimoEntranteEn,
});
const comentario = (ultimoEntranteEn: Date | null, canal = "facebook"): ItemVentana => ({
  tipo: "comentario",
  canal,
  ultimoEntranteEn,
});

test("un chat de WhatsApp está abierto durante 24 h desde que la persona escribió", () => {
  assert.equal(ventanaAbierta(chat(hace(1 * HORA)), AHORA), true);
  assert.equal(ventanaAbierta(chat(hace(23 * HORA)), AHORA), true);
  assert.equal(ventanaAbierta(chat(hace(25 * HORA)), AHORA), false);
});

test("el plazo del chat sale de la constante, no de un 24 escrito en el test", () => {
  const justoAdentro = hace(VENTANA_MENSAJE_HORAS * HORA - 1);
  const justoAfuera = hace(VENTANA_MENSAJE_HORAS * HORA + 1);
  assert.equal(ventanaAbierta(chat(justoAdentro), AHORA), true);
  assert.equal(ventanaAbierta(chat(justoAfuera), AHORA), false);
});

test("un comentario de FB/IG está abierto 7 días, no 24 h", () => {
  assert.equal(ventanaAbierta(comentario(hace(3 * DIA)), AHORA), true);
  assert.equal(ventanaAbierta(comentario(hace(3 * DIA), "instagram"), AHORA), true);
  assert.equal(ventanaAbierta(comentario(hace(VENTANA_META_DIAS * DIA + HORA)), AHORA), false);
});

/**
 * EL CASO QUE JUSTIFICA TODO EL MÓDULO. Si la ventana se contara desde «lo
 * último que pasó» —que es lo que hace `referencia` en `urgenciaSql.ts`—,
 * responderle a alguien reiniciaría el reloj y la vendedora vería la puerta
 * abierta hasta 24 h después de que Meta ya la cerró.
 */
test("NUESTRA respuesta no extiende la ventana: se cuenta desde el último ENTRANTE", () => {
  // Escribió hace 25 h (ventana vencida) y le contestamos recién hace 1 h.
  const item = chat(hace(25 * HORA));
  assert.equal(ventanaAbierta(item, AHORA), false);
  assert.equal(ventanaRestanteMs(item, AHORA), 0);
});

test("sin ningún entrante no hay ventana: es «no aplica», no «cerrada»", () => {
  assert.equal(ventanaCierraEn(chat(null)), null);
  assert.equal(ventanaRestanteMs(chat(null), AHORA), null);
  assert.equal(ventanaAbierta(chat(null), AHORA), false);
});

test("un comentario de un canal sin ventana no inventa una", () => {
  assert.equal(ventanaCierraEn(comentario(hace(HORA), "whatsapp")), null);
  assert.equal(ventanaCierraEn(comentario(hace(HORA), "tiktok")), null);
});

test("lo que falta nunca es negativo: una ventana cerrada devuelve 0", () => {
  assert.equal(ventanaRestanteMs(chat(hace(100 * HORA)), AHORA), 0);
  assert.equal(ventanaRestanteMs(comentario(hace(30 * DIA)), AHORA), 0);
});

test("lo que falta es exacto, para poder dibujar la cuenta regresiva", () => {
  assert.equal(ventanaRestanteMs(chat(hace(20 * HORA)), AHORA), 4 * HORA);
  assert.equal(ventanaRestanteMs(comentario(hace(2 * DIA)), AHORA), (VENTANA_META_DIAS - 2) * DIA);
});

/**
 * Un canal nuevo de mensajería (un DM de Instagram, mañana un Telegram) entra
 * por la rama de `mensaje` y tiene sus 24 h sin que nadie lo agregue a una
 * lista. Es deliberado: el canal que se olvida de declarar aparece SIN señal,
 * nunca con una ventana inventada de otro plazo.
 */
test("cualquier canal de mensajería hereda las 24 h; el comentario necesita estar declarado", () => {
  assert.equal(ventanaAbierta(chat(hace(2 * HORA), "instagram"), AHORA), true);
  assert.equal(ventanaAbierta(chat(hace(2 * HORA), "facebook"), AHORA), true);
  assert.equal(ventanaCierraEn(comentario(hace(2 * HORA), "canal-nuevo")), null);
});
