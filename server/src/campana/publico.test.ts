import assert from "node:assert/strict";
import test from "node:test";
import { contarPorMotivo, elegirPublico, type Candidato } from "./publico.js";

const base: Candidato = {
  telefono: "51900000000",
  mensajes: ["Hola, información por favor"],
  anuncio: "Diploma de Inteligencia",
  yaLeLlego: false,
  yaCompro: false,
};
const con = (p: Partial<Candidato>): Candidato => ({ ...base, ...p });

test("EL DEFECTO DE LA PRIMERA CAMPAÑA: un «no» en el tercer mensaje se ve", () => {
  // Esto es exactamente lo que paso: el script preguntaba huboRechazo([primerMensaje])
  // y esta persona -que dijo «Ya no quiero»- recibio la promocion.
  const r = elegirPublico([con({ mensajes: ["Hola", "cuanto cuesta?", "Ya no quiero"] })]);
  assert.equal(r.publico.length, 0, "dijo que no: no puede estar en el publico");
  assert.deepEqual(r.descartados, [{ telefono: "51900000000", motivo: "rechazo" }]);
});

test("y con el primer mensaje SOLO, el mismo caso pasaba — la regresion queda fijada", () => {
  const soloElPrimero = elegirPublico([con({ mensajes: ["Hola"] })]);
  assert.equal(soloElPrimero.publico.length, 1, "el primer mensaje por si solo no dice nada");
  const conTodos = elegirPublico([con({ mensajes: ["Hola", "Ya no quiero"] })]);
  assert.equal(conTodos.publico.length, 0, "mirando todos, se ve");
});

test("la despedida se mira SOLO en el ultimo mensaje", () => {
  const alFinal = elegirPublico([
    con({ mensajes: ["hola", "agradezco mucho la atencion prestada"] }),
  ]);
  assert.equal(alFinal.descartados[0]?.motivo, "despedida");

  // La misma frase en el medio, con una consulta despues: la conversacion siguio.
  const enElMedio = elegirPublico([
    con({ mensajes: ["agradezco mucho la atencion prestada", "me pasas el temario?"] }),
  ]);
  assert.equal(enElMedio.publico.length, 1, "despues se despedirse volvio a preguntar");
});

test("el rechazo le gana a la despedida: el motivo tiene que ser defendible", () => {
  const r = elegirPublico([con({ mensajes: ["no me interesa", "gracias, hasta luego"] })]);
  assert.equal(r.descartados[0]?.motivo, "rechazo");
});

test("quien ya compro queda afuera por default, y se puede incluir a proposito", () => {
  const fuera = elegirPublico([con({ yaCompro: true })]);
  assert.equal(fuera.descartados[0]?.motivo, "ya_compro");
  const dentro = elegirPublico([con({ yaCompro: true })], { excluirClientes: false });
  assert.equal(dentro.publico.length, 1);
});

test("sin anuncio queda afuera por default", () => {
  const fuera = elegirPublico([con({ anuncio: null })]);
  assert.equal(fuera.descartados[0]?.motivo, "sin_anuncio");
  const dentro = elegirPublico([con({ anuncio: null })], { soloDeAnuncio: false });
  assert.equal(dentro.publico.length, 1);
});

test("EL PUBLICO INCLUYE A QUIEN YA LO RECIBIO; LOS ELEGIBLES NO", () => {
  // La conversacion es suya igual: dejarla sin duena porque el envio llego
  // primero es al reves de lo que hace falta cuando conteste.
  const r = elegirPublico([con({ yaLeLlego: true })]);
  assert.equal(r.publico.length, 1, "sigue siendo su conversacion");
  assert.equal(r.elegibles.length, 0, "pero no se le manda un segundo mensaje");
  assert.equal(r.descartados[0]?.motivo, "ya_le_llego");
});

test("quien dijo que no NO entra al publico ni para asignarle duena por esta via", () => {
  const r = elegirPublico([con({ mensajes: ["no me interesa"], yaLeLlego: true })]);
  assert.equal(r.publico.length, 0);
  assert.equal(r.descartados[0]?.motivo, "rechazo", "un solo motivo por persona, el mas grave");
  assert.equal(r.descartados.length, 1);
});

test("el tope recorta los elegibles y no el publico", () => {
  const muchos = Array.from({ length: 10 }, (_, i) => con({ telefono: `5190000000${i}` }));
  const r = elegirPublico(muchos, { tope: 3 });
  assert.equal(r.publico.length, 10);
  assert.equal(r.elegibles.length, 3);
});

test("contarPorMotivo devuelve los cinco motivos, con cero incluido", () => {
  const r = elegirPublico([
    con({ telefono: "1", mensajes: ["no me interesa"] }),
    con({ telefono: "2", anuncio: null }),
    con({ telefono: "3" }),
  ]);
  const c = contarPorMotivo(r.descartados);
  assert.equal(c.rechazo, 1);
  assert.equal(c.sin_anuncio, 1);
  assert.equal(c.ya_compro, 0, "un motivo sin casos vale cero, no desaparece");
  assert.equal(r.elegibles.length, 1);
});

test("«gracias» a secas no es una despedida (lo decide rechazo.ts, no este modulo)", () => {
  const r = elegirPublico([con({ mensajes: ["hola", "gracias"] })]);
  assert.equal(r.publico.length, 1);
});

/**
 * EL DEFECTO QUE ESTE TEST MATA, visto en el simulacro de la campaña del Foro:
 * con `tope: 1000` sobre 3.069 candidatos, el script anunciaba «se van a asignar
 * 3.069 conversaciones · las 1.000 que reciben el mensaje MÁS las 2.069 que ya
 * lo habían recibido». Las 2.069 no habían recibido nada: eran las del recorte.
 */
test("el tope no arrastra a nadie a la asignación: aAsignar son los que reciben", () => {
  const candidatos = Array.from({ length: 10 }, (_, i) => ({
    telefono: `5198765432${i}`,
    mensajes: ["hola"],
    anuncio: "un anuncio",
    yaLeLlego: false,
    yaCompro: false,
  }));

  const { elegibles, aAsignar, publico } = elegirPublico(candidatos, { tope: 3 });

  assert.equal(elegibles.length, 3);
  assert.equal(aAsignar.length, 3, "los 7 que el tope dejó afuera NO se asignan");
  assert.equal(publico.length, 10, "pero siguen siendo a quienes les corresponde");
});

test("quien ya lo había recibido SÍ se asigna, aunque no reciba de nuevo", () => {
  const { elegibles, aAsignar } = elegirPublico(
    [
      { telefono: "51900000001", mensajes: ["hola"], anuncio: "x", yaLeLlego: true, yaCompro: false },
      { telefono: "51900000002", mensajes: ["hola"], anuncio: "x", yaLeLlego: false, yaCompro: false },
    ],
    {},
  );

  assert.deepEqual(elegibles.map((c) => c.telefono), ["51900000002"]);
  // Cuando el que ya lo recibió conteste, tiene que caer en la cola de alguien.
  assert.deepEqual(new Set(aAsignar.map((c) => c.telefono)), new Set(["51900000001", "51900000002"]));
});
