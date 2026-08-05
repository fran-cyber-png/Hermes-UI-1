import assert from "node:assert/strict";
import test from "node:test";
import { esperasDelHilo, resumirAtencion, type MensajeDelHilo } from "./tiempos.js";

const T0 = new Date("2026-08-04T14:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);

const entra = (m: number): MensajeDelHilo => ({ cuando: min(m), direccion: "entrante" });
const persona = (m: number): MensajeDelHilo => ({
  cuando: min(m),
  direccion: "saliente",
  quien: "persona",
});
const maquina = (m: number): MensajeDelHilo => ({
  cuando: min(m),
  direccion: "saliente",
  quien: "maquina",
});

test("la espera va del mensaje de la persona a la respuesta humana", () => {
  const e = esperasDelHilo([entra(0), persona(30)], min(60));
  assert.deepEqual(e, [{ escribioEn: min(0), minutos: 30 }]);
});

test("REGLA 1 · una seguidilla se cuenta desde el PRIMER mensaje, no desde el último", () => {
  // Quien insiste porque nadie le contesta no debe verse mejor atendido.
  const e = esperasDelHilo([entra(0), entra(1), entra(2), persona(30)], min(60));
  assert.equal(e.length, 1);
  assert.equal(e[0].minutos, 30, "medido desde el último daría 28 y premiaría la desatención");
});

test("REGLA 2 · una máquina NO cierra la espera", () => {
  // El acuse nocturno / la plantilla de campaña salen de nuestro lado y no son
  // atención: si contaran, la métrica diría «un minuto» la noche que nadie miró.
  const e = esperasDelHilo([entra(0), maquina(1), persona(45)], min(60));
  assert.deepEqual(e, [{ escribioEn: min(0), minutos: 45 }]);
});

test("REGLA 2 · una máquina tampoco REINICIA el reloj", () => {
  const e = esperasDelHilo([entra(0), maquina(10), maquina(20), persona(30)], min(60));
  assert.equal(e[0].minutos, 30, "la persona siguió esperando a un humano todo el tiempo");
});

test("REGLA 3 · lo que sigue sin respuesta sale como espera abierta, no se descarta", () => {
  const e = esperasDelHilo([entra(0), maquina(1)], min(90));
  assert.deepEqual(e, [{ escribioEn: min(0), minutos: null }]);
});

test("un saliente humano sin nadie esperando no es una respuesta", () => {
  // La campaña es una INICIACIÓN: sale primero y no responde a nada.
  assert.deepEqual(esperasDelHilo([persona(0), maquina(1)], min(60)), []);
});

test("varias idas y vueltas dan varias esperas", () => {
  const e = esperasDelHilo([entra(0), persona(5), entra(10), persona(70)], min(90));
  assert.deepEqual(
    e.map((x) => x.minutos),
    [5, 60],
  );
});

test("la última quedó abierta y las anteriores no", () => {
  const e = esperasDelHilo([entra(0), persona(5), entra(10)], min(90));
  assert.deepEqual(
    e.map((x) => x.minutos),
    [5, null],
  );
  assert.equal(e[1].escribioEn.getTime(), min(10).getTime());
});

test("una mediana NO se puede leer sin saber sobre cuántas de cuántas se calculó", () => {
  const esperas = [
    { escribioEn: min(0), minutos: 2 },
    { escribioEn: min(0), minutos: 4 },
    { escribioEn: min(0), minutos: 6 },
    { escribioEn: min(0), minutos: null },
    { escribioEn: min(0), minutos: null },
  ];
  const r = resumirAtencion(esperas, min(1000));
  assert.equal(r.mediana?.minutos, 4);
  // Lo que impide presentar «4 minutos» como si describiera al conjunto:
  assert.equal(r.mediana?.sobre, 3);
  assert.equal(r.mediana?.de, 5);
  assert.equal(r.sinResponder, 2);
});

test("sin ni una respondida no hay mediana — null, nunca cero", () => {
  const r = resumirAtencion([{ escribioEn: min(0), minutos: null }], min(60));
  assert.equal(r.mediana, null, "un 0 se leería como «contestamos al instante»");
  assert.equal(r.p90, null);
  assert.equal(r.sinResponder, 1);
});

test("la espera abierta más vieja se mide contra el reloj que se le pasa", () => {
  const r = resumirAtencion(
    [
      { escribioEn: min(0), minutos: null },
      { escribioEn: min(50), minutos: null },
    ],
    min(120),
  );
  assert.equal(r.masViejaSinResponder, 120);
});

test("los tramos son acumulativos y sólo cuentan respondidas", () => {
  const r = resumirAtencion(
    [
      { escribioEn: min(0), minutos: 3 },
      { escribioEn: min(0), minutos: 40 },
      { escribioEn: min(0), minutos: 600 },
      { escribioEn: min(0), minutos: 3000 },
      { escribioEn: min(0), minutos: null },
    ],
    min(5000),
  );
  assert.equal(r.en5Min, 1);
  assert.equal(r.en1Hora, 2);
  assert.equal(r.en24Horas, 3);
  assert.equal(r.respondidas, 4);
});

test("el caso de la campaña 3x1: sale la plantilla, contestan, nadie responde", () => {
  const hilo: MensajeDelHilo[] = [
    maquina(0), // la HSM de la campaña
    entra(1), // «Quiero el paquete»
  ];
  const e = esperasDelHilo(hilo, min(180));
  assert.deepEqual(e, [{ escribioEn: min(1), minutos: null }]);
  const r = resumirAtencion(e, min(180));
  assert.equal(r.sinResponder, 1);
  assert.equal(r.masViejaSinResponder, 179);
  assert.equal(r.mediana, null);
});
