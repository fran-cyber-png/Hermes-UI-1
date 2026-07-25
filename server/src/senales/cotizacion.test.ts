import test from "node:test";
import assert from "node:assert/strict";
import { esCotizacion, montosDelTexto } from "./cotizacion.js";

/**
 * EL CORPUS DE CONTRASTE del detector de cotización.
 *
 * Los textos POSITIVOS son la forma real en que las vendedoras mandan el precio
 * (minería de producción del 2026-07-25: 696 conversaciones con precio enviado).
 * Los NEGATIVOS son las trampas que el regex ingenuo marcaba mal — sobre todo la
 * que pidió el dueño por nombre: «tenemos cuenta bancaria en soles» NO es una
 * cotización.
 *
 * Este archivo ES la evidencia de precisión: cada negativo que pasa es un falso
 * positivo que el detector ya no comete. Ver `docs/adr/0015`.
 */

/** Lo que la vendedora manda cuando de verdad está cotizando. */
const COTIZACIONES: string[] = [
  "La inversión del diploma es de S/250",
  "El precio es S/. 250 soles",
  "Cuesta 250 soles con certificado incluido",
  "La promoción está en S/199 hasta el viernes",
  "Son 135 soles el diploma completo",
  "El costo es de USD 60 para extranjeros",
  "Te queda en $60 dólares",
  "S/250",
  "Inversión: S/ 1,200 el pack completo",
  "matrícula S/100 y el resto en dos cuotas",
  "el diploma tiene un precio de s/ 250.00",
  // El texto real de la plantilla, con emoji y saltos de línea.
  "🕵️‍♂️DIPLOMA INTERNACIONAL DE INTELIGENCIA Y CONTRAINTELIGENCIA\n\nInversión: S/ 250\nDuración: 3 semanas",
];

/** Lo que NO es una cotización aunque hable de plata, soles o números. */
const NO_COTIZACIONES: string[] = [
  // La que pidió el dueño: menciona soles, no cotiza nada.
  "Tenemos cuenta bancaria en soles y en dólares",
  "Puedes depositar en nuestra cuenta de ahorros en soles",
  "Nuestra cuenta BCP soles 191-1234567-0-52",
  "El número de cuenta interbancario es 00219100123456789052",
  "Te paso el CCI 002-191-001234567890-52 para la transferencia",
  // Los textos canónicos de la secuencia de venta: NO llevan precio.
  "El diploma dura 3 semanas de clases en vivo, martes y jueves de 8 a 10 pm",
  "Temario del diploma",
  "👋 Hola, te saluda Luz, asesora comercial de Goberna",
  "Las clases empiezan el 15 de agosto y son 120 horas académicas",
  "Somos más de 5000 egresados en 20 países",
  // Números sin moneda: fechas, horas, cantidades.
  "Son 11 módulos en total",
  "Te escribo al 986394450 para coordinar",
  "Mi DNI es 45678912",
  "",
  "   ",
];

test("las cotizaciones reales del histórico se detectan todas", () => {
  const fallidas = COTIZACIONES.filter((t) => !esCotizacion(t).esCotizacion);
  assert.deepEqual(fallidas, [], "estas cotizaciones reales quedaron sin detectar");
});

test("nada de lo que solo habla de plata cuenta como cotización", () => {
  const falsosPositivos = NO_COTIZACIONES.filter((t) => esCotizacion(t).esCotizacion);
  assert.deepEqual(falsosPositivos, [], "estos textos NO son cotizaciones y se marcaron como tales");
});

test("«cuenta bancaria en soles» no es cotización, y el veredicto lo explica", () => {
  const v = esCotizacion("Tenemos cuenta bancaria en soles");
  assert.equal(v.esCotizacion, false);
  assert.equal(v.montos.length, 0, "no hay ningún monto: la frase no trae cifra");
  assert.match(v.motivo, /monto/i);
});

test("un número de cuenta pegado a «soles» no se lee como monto", () => {
  assert.deepEqual(montosDelTexto("Cuenta BCP soles 191-1234567-0-52"), []);
  assert.deepEqual(montosDelTexto("Yape al 986394450"), []);
});

test("el monto con palabra de precio da confianza alta; el monto solo, media", () => {
  assert.equal(esCotizacion("La inversión es S/250").confianza, "alta");
  assert.equal(esCotizacion("S/250").confianza, "media");
  assert.equal(esCotizacion("Hola, ¿cómo estás?").confianza, null);
});

test("un monto en contexto de cuenta bancaria queda vetado", () => {
  const v = esCotizacion("Deposita a la cuenta de ahorros BCP soles S/ 250");
  assert.equal(v.esCotizacion, false, "el monto está pegado a una cuenta: es instrucción de pago");
  assert.ok(v.vetos.length > 0);
});

test("pero si además hay palabra de precio, la cuenta no veta la cotización", () => {
  // «El precio es S/250, lo depositas a la cuenta BCP» sigue siendo una cotización.
  const v = esCotizacion("El precio es S/250, lo depositas a la cuenta BCP");
  assert.equal(v.esCotizacion, true);
});

test("los montos absurdos no cuentan (ni S/0 ni un millón)", () => {
  assert.equal(esCotizacion("S/0 de inicial").esCotizacion, false);
  assert.equal(esCotizacion("cuesta S/ 5").esCotizacion, false);
  assert.equal(esCotizacion("S/ 999999999").esCotizacion, false);
});

test("el separador de miles y el decimal se leen bien", () => {
  assert.equal(montosDelTexto("S/ 1,200")[0].valor, 1200);
  assert.equal(montosDelTexto("S/ 1.200")[0].valor, 1200);
  assert.equal(montosDelTexto("S/ 250.00")[0].valor, 250);
  assert.equal(montosDelTexto("S/ 250,50")[0].valor, 250.5);
});

test("la moneda se distingue: soles vs dólares", () => {
  assert.equal(montosDelTexto("S/250")[0].moneda, "PEN");
  assert.equal(montosDelTexto("250 soles")[0].moneda, "PEN");
  assert.equal(montosDelTexto("USD 60")[0].moneda, "USD");
  assert.equal(montosDelTexto("60 dólares")[0].moneda, "USD");
  assert.equal(montosDelTexto("$60")[0].moneda, "USD");
});

test("los acentos y las mayúsculas no cambian el veredicto", () => {
  assert.equal(esCotizacion("LA INVERSIÓN ES DE S/250").esCotizacion, true);
  assert.equal(esCotizacion("la inversion es de s/250").esCotizacion, true);
});

test("un texto nulo o vacío no revienta", () => {
  assert.equal(esCotizacion(null).esCotizacion, false);
  assert.equal(esCotizacion(undefined).esCotizacion, false);
});
