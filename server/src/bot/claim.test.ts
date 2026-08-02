import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ESPERA_MAXIMA_MS,
  VIGENCIA_CLAIM_MS,
  corteDeClaim,
  esRecuperacion,
  esperaExcesiva,
  sePuedeTomar,
  segundosTomado,
} from "./claim.js";

const AHORA = new Date("2026-08-01T15:00:00Z");
const haceMs = (ms: number) => new Date(AHORA.getTime() - ms);

describe("sePuedeTomar — el claim vence, que es todo el punto", () => {
  test("sin nadie tomándolo, se toma", () => {
    assert.equal(sePuedeTomar(null, AHORA), true);
  });

  test("recién tomado, NO se toma: hay un pipeline vivo del otro lado", () => {
    assert.equal(sePuedeTomar(haceMs(1000), AHORA), false);
  });

  test("el turno más lento que existe (3 min) todavía está protegido", () => {
    assert.equal(sePuedeTomar(haceMs(3 * 60_000), AHORA), false);
  });

  test("pasada la vigencia, se recupera — es el deploy que mató el proceso", () => {
    assert.equal(sePuedeTomar(haceMs(VIGENCIA_CLAIM_MS + 1), AHORA), true);
  });

  test("justo en el corte NO se toma: el empate lo gana el que lo tiene", () => {
    // Es la misma regla que `vendedoraActivaDesde` (`frenos.ts`): ante dos
    // instantes iguales no se sabe cuál fue primero, y duplicar una respuesta es
    // peor que esperar un tick más de 5 segundos.
    assert.equal(sePuedeTomar(corteDeClaim(AHORA), AHORA), false);
  });
});

describe("esRecuperacion — para que el silencio deje un renglón", () => {
  test("un pendiente nuevo no es una recuperación", () => {
    assert.equal(esRecuperacion(null, AHORA), false);
  });

  test("uno vencido sí, y es lo único que se loguea distinto", () => {
    assert.equal(esRecuperacion(haceMs(VIGENCIA_CLAIM_MS + 60_000), AHORA), true);
  });

  test("uno en vuelo no lo es (ni se toma)", () => {
    assert.equal(esRecuperacion(haceMs(30_000), AHORA), false);
  });

  test("segundosTomado dice cuánto estuvo colgado", () => {
    assert.equal(segundosTomado(haceMs(420_000), AHORA), 420);
  });
});

describe("esperaExcesiva — la lección de #166 aplicada al claim que vuelve", () => {
  test("un entrante de hace un rato se contesta", () => {
    assert.equal(esperaExcesiva(haceMs(30 * 60_000), AHORA), false);
  });

  test("uno de hace siete horas NO: contestarlo confirma que nadie miraba", () => {
    assert.equal(esperaExcesiva(haceMs(ESPERA_MAXIMA_MS + 60_000), AHORA), true);
  });

  test("sin fecha de entrante no se descarta: no saber no es una decisión", () => {
    assert.equal(esperaExcesiva(null, AHORA), false);
  });

  test("justo en el techo todavía entra", () => {
    assert.equal(esperaExcesiva(haceMs(ESPERA_MAXIMA_MS), AHORA), false);
  });
});

describe("los dos umbrales, uno al lado del otro", () => {
  test("la vigencia del claim es MUCHO menor que la espera máxima", () => {
    // Si alguien los acerca, que sea a conciencia: un claim que vence a las 6 h
    // no recupera nada (para entonces el entrante ya no se contesta), y una
    // espera máxima de 5 min tiraría a la basura todo lo que llegó de noche.
    assert.ok(VIGENCIA_CLAIM_MS * 10 < ESPERA_MAXIMA_MS);
  });
});
