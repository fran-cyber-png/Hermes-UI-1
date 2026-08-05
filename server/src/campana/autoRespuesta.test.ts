import assert from "node:assert/strict";
import test from "node:test";
import { esAutoRespuestaDeNegocio } from "./autoRespuesta.js";

/**
 * EL CORPUS ES REAL. Son las 13 primeras respuestas a las campañas del
 * 5-ago-2026, copiadas literalmente de producción — cinco bots y ocho
 * personas. Si el detector cambia y alguna de estas se da vuelta, el test lo
 * dice con el mensaje que la persona escribió de verdad.
 */

const BOTS_DE_OTRAS_EMPRESAS = [
  "Gracias por comunicarte con JM RUSH AUTOMOTRIZ, en qué te podemos ayudar ?",
  "Gracias por comunicarte con JEARMA Consultorias  ¿Cómo podemos ayudarte?",
  "⚖️  Gracias por comunicarte con ALTAMIRANO. 👩🏻‍⚖️🫆🪪⚖️ Análisis jurídico, criminalístico y prevención del delito",
  "Gracias por comunicarte con Lander Valera ¿Cómo puedo ayudarte?",
  "¡Hola! 👋 Gracias por contactar a Reynaldo Marketing Político, me comunicaré contigo en breve ¿Cuál es tu nombre?",
];

const PERSONAS_DE_VERDAD = [
  "de que se trata la credencial internacional",
  "Tienes libros de pensamiento crítico",
  "Okey",
  "Quiero el paquete",
  "Ok gracias",
  "Hola",
  "Hasta cuándo es el plazo",
  "Hola buenas tardes, por ahora no para otra oportunidad será muchas gracias 😊",
];

test("LOS CINCO BOTS REALES se detectan", () => {
  for (const t of BOTS_DE_OTRAS_EMPRESAS) {
    assert.equal(esAutoRespuestaDeNegocio(t), true, `debería ser bot: «${t.slice(0, 50)}»`);
  }
});

test("LAS OCHO PERSONAS REALES NO se detectan como bot", () => {
  // Este es el lado caro del error: esconder a una persona cuesta un lead que
  // nadie va a buscar, porque la pantalla dijo que no existía.
  for (const t of PERSONAS_DE_VERDAD) {
    assert.equal(esAutoRespuestaDeNegocio(t), false, `es una persona: «${t.slice(0, 50)}»`);
  }
});

test("🔴 «Quiero el paquete» JAMÁS puede leerse como bot", () => {
  // La venta más caliente de las dos campañas. Si el detector se la come, la
  // pantalla la esconde y nadie la atiende nunca.
  assert.equal(esAutoRespuestaDeNegocio("Quiero el paquete"), false);
});

test("«gracias» a secas de una persona no alcanza", () => {
  for (const t of ["gracias", "muchas gracias", "gracias!", "ok gracias"]) {
    assert.equal(esAutoRespuestaDeNegocio(t), false);
  }
});

test("EXIGE LA INVERSIÓN DE ROLES, no sólo la palabra «gracias por»", () => {
  // Una persona agradeciendo el mensaje NO es un contestador. Sin la
  // preposición, «gracias por comunicarte» a secas lo dice cualquiera.
  assert.equal(esAutoRespuestaDeNegocio("gracias por comunicarte"), false);
  assert.equal(esAutoRespuestaDeNegocio("gracias por escribirme, te leo"), false);
  assert.equal(esAutoRespuestaDeNegocio("Gracias por comunicarte con nosotros"), true);
});

test("los acentos y las mayúsculas no cambian el veredicto", () => {
  assert.equal(esAutoRespuestaDeNegocio("GRACIAS POR COMUNICARTE CON ACME"), true);
  assert.equal(esAutoRespuestaDeNegocio("gracias por comunicarté con acme"), true);
});

test("las frases de contestador que no invierten roles", () => {
  assert.equal(esAutoRespuestaDeNegocio("Este es un mensaje automático"), true);
  assert.equal(esAutoRespuestaDeNegocio("Hemos recibido tu mensaje, te responderemos"), true);
  assert.equal(esAutoRespuestaDeNegocio("Nuestro horario de atención es de 9 a 6"), true);
});

test("no explota con nada raro", () => {
  for (const raro of [null, undefined, "", "   ", "😊", 42 as never, {} as never]) {
    assert.equal(esAutoRespuestaDeNegocio(raro), false);
  }
});

test("un texto larguísimo no rompe ni acierta de casualidad", () => {
  assert.equal(esAutoRespuestaDeNegocio("hola ".repeat(2000)), false);
});
