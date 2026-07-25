import test from "node:test";
import assert from "node:assert/strict";
import type { Plantilla } from "../plantillas/repositorio.js";
import { intencionesDePlantilla } from "./clasificar.js";
import { intencionesSugeridas, type EstadoDeVenta } from "./estado.js";
import { sugerirDos } from "./sugerir.js";

const base: EstadoDeVenta = {
  esPrimerContacto: false,
  curso: null,
  pidioInfo: false,
  cotizada: false,
  enfriada: false,
  vioMaterial: false,
};

const plantilla = (p: Partial<Plantilla> & { id: number; nombre: string }): Plantilla => ({
  familiaCurso: null,
  estado: "aprobada",
  origen: "manual",
  respaldo: 0,
  usos: 0,
  pasos: [{ orden: 1, texto: p.nombre, media: null, mediaPendiente: false }],
  ...p,
});

const CON_IMAGEN = plantilla({
  id: 1,
  nombre: "Flyer del diploma",
  usos: 40,
  pasos: [
    {
      orden: 1,
      texto: "DIPLOMA INTERNACIONAL DE INTELIGENCIA",
      media: { archivo: "f.jpg", mime: "image/jpeg", clase: "imagen", nombre: "f.jpg" },
      mediaPendiente: false,
    },
  ],
});
const TEMARIO = plantilla({
  id: 2,
  nombre: "Temario",
  usos: 20,
  pasos: [{ orden: 1, texto: "Te comparto el temario del diploma", media: null, mediaPendiente: false }],
});
const PRECIO = plantilla({
  id: 3,
  nombre: "Cotización",
  usos: 30,
  pasos: [{ orden: 1, texto: "La inversión del {curso} es {precio}", media: null, mediaPendiente: false }],
});
const SEGUIMIENTO = plantilla({
  id: 4,
  nombre: "Seguimiento",
  usos: 10,
  pasos: [{ orden: 1, texto: "Hola, ¿pudiste ver el temario? ¿Te queda alguna duda?", media: null, mediaPendiente: false }],
});
const REACTIVAR = plantilla({
  id: 5,
  nombre: "Última llamada",
  usos: 5,
  pasos: [{ orden: 1, texto: "Vuelvo a escribirte: quedan pocas vacantes para esta edición", media: null, mediaPendiente: false }],
});
const PRESENTARSE = plantilla({
  id: 6,
  nombre: "Saludo",
  usos: 25,
  pasos: [{ orden: 1, texto: "Hola, te saluda Luz, asesora comercial de Goberna", media: null, mediaPendiente: false }],
});

const TODAS = [CON_IMAGEN, TEMARIO, PRECIO, SEGUIMIENTO, REACTIVAR, PRESENTARSE];

test("clasificar: el detector de precio de las señales es el que decide «precio»", () => {
  assert.ok(intencionesDePlantilla(PRECIO).has("precio"));
  // Un monto real, sin la variable, también.
  const conMonto = plantilla({ id: 9, nombre: "x", pasos: [{ orden: 1, texto: "Son S/250 con certificado", media: null, mediaPendiente: false }] });
  assert.ok(intencionesDePlantilla(conMonto).has("precio"));
  // «Tenemos cuenta bancaria en soles» NO es una cotización (regla de PR 1).
  const banco = plantilla({ id: 10, nombre: "x", pasos: [{ orden: 1, texto: "Tenemos cuenta bancaria en soles", media: null, mediaPendiente: false }] });
  assert.equal(intencionesDePlantilla(banco).has("precio"), false);
});

test("clasificar: una secuencia con imagen es flyer aunque no lo diga", () => {
  assert.ok(intencionesDePlantilla(CON_IMAGEN).has("flyer"));
});

test("primer contacto: flyer primero, presentarse como segundo camino", () => {
  const r = sugerirDos({ ...base, esPrimerContacto: true }, TODAS);
  assert.deepEqual(
    r.map((s) => s.intencion),
    ["flyer", "presentarse"],
  );
  assert.equal(r[0].plantilla.id, CON_IMAGEN.id);
  assert.match(r[0].porque, /primer mensaje/);
});

test("vio el material y no sabe el precio: cotizar es lo primero", () => {
  const r = sugerirDos({ ...base, vioMaterial: true }, TODAS);
  assert.deepEqual(
    r.map((s) => s.intencion),
    ["precio", "temario"],
  );
  assert.match(r[0].porque, /cuánto cuesta/);
});

test("cotizada y viva: seguimiento, no repetirle el precio", () => {
  const r = sugerirDos({ ...base, cotizada: true, vioMaterial: true }, TODAS);
  assert.equal(r[0].intencion, "seguimiento");
  assert.equal(r[0].plantilla.id, SEGUIMIENTO.id);
});

test("se enfrió: reactivar gana sobre todo lo demás", () => {
  const r = sugerirDos(
    { ...base, esPrimerContacto: true, pidioInfo: true, cotizada: true, enfriada: true },
    TODAS,
  );
  assert.equal(r[0].intencion, "reactivar");
  assert.match(r[0].porque, /no contestó/);
});

test("las dos sugerencias son SIEMPRE plantillas distintas", () => {
  for (const estado of [
    { ...base, esPrimerContacto: true },
    { ...base, vioMaterial: true },
    { ...base, cotizada: true },
    { ...base, enfriada: true, cotizada: true },
    { ...base, pidioInfo: true },
    base,
  ]) {
    const r = sugerirDos(estado, TODAS);
    if (r.length === 2) assert.notEqual(r[0].plantilla.id, r[1].plantilla.id);
  }
});

test("sin plantillas no se inventa nada: cero sugerencias", () => {
  assert.deepEqual(sugerirDos({ ...base, esPrimerContacto: true }, []), []);
});

test("una propuesta sin aprobar NUNCA se sugiere: no se puede mandar", () => {
  const propuesta = { ...CON_IMAGEN, estado: "propuesta" as const };
  assert.deepEqual(sugerirDos({ ...base, esPrimerContacto: true }, [propuesta]), []);
});

test("una plantilla con la imagen sin cargar tampoco se sugiere", () => {
  const rota = plantilla({
    id: 7,
    nombre: "Flyer sin imagen",
    pasos: [{ orden: 1, texto: "diploma", media: null, mediaPendiente: true }],
  });
  assert.deepEqual(sugerirDos({ ...base, esPrimerContacto: true }, [rota]), []);
});

test("con una sola coincidencia se completa con la más usada, pero nunca la repetida", () => {
  const r = sugerirDos({ ...base, esPrimerContacto: true }, [CON_IMAGEN, TEMARIO]);
  assert.equal(r.length, 2);
  assert.notEqual(r[0].plantilla.id, r[1].plantilla.id);
  assert.match(r[1].porque, /más usada/);
});

test("con UNA sola plantilla en el catálogo, se sugiere una — no dos veces la misma", () => {
  const r = sugerirDos({ ...base, esPrimerContacto: true }, [CON_IMAGEN]);
  assert.equal(r.length, 1);
});

test("a igual intención gana la más usada", () => {
  const poco = plantilla({ id: 8, nombre: "Temario viejo", usos: 1, pasos: TEMARIO.pasos });
  const r = sugerirDos({ ...base, vioMaterial: true }, [PRECIO, TEMARIO, poco]);
  assert.equal(r[1].plantilla.id, TEMARIO.id);
});

test("las reglas siempre dan dos caminos distintos", () => {
  const estados: EstadoDeVenta[] = [
    { ...base, enfriada: true },
    { ...base, cotizada: true },
    { ...base, vioMaterial: true },
    { ...base, esPrimerContacto: true },
    { ...base, pidioInfo: true },
    base,
  ];
  for (const e of estados) {
    const [a, b] = intencionesSugeridas(e);
    assert.notEqual(a.intencion, b.intencion, JSON.stringify(e));
    assert.ok(a.porque.length > 5 && b.porque.length > 5);
  }
});
