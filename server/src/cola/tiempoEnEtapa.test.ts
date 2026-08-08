import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { etapaEfectiva } from "./etapaEfectivaSql.js";
import {
  etapaDesde,
  paraSeguir,
  SEGUIR_DESDE_DIAS,
  SEGUIR_HASTA_DIAS,
  type HechosDeEtapa,
} from "./tiempoEnEtapa.js";

/**
 * LA REGLA DEL TIEMPO EN ETAPA, interrogada sin base.
 *
 * Lo que estos casos fijan no es la aritmética (restar dos fechas no se rompe):
 * es **de cuál de los dos hechos sale la fecha**, que es donde vive todo el
 * riesgo. Una fecha equivocada acá no da error ni log — da un número plausible
 * en la tarjeta, y encima en la columna donde la antigüedad ES el criterio.
 */

const DIA = 86_400_000;
const AHORA = new Date("2026-08-08T12:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * DIA);

/**
 * Una conversación sin ningún hecho fechado, pero donde LOS DOS hablaron — que es
 * la forma normal. `hablo: true` es deliberado: con `false` cada caso de acá
 * abajo caería en `sin_respuesta` y estaría probando otra cosa. Los casos del
 * estado nuevo lo bajan explícitamente.
 */
const NADA: HechosDeEtapa = {
  etapaManual: null,
  gestionAt: null,
  respondida: false,
  precioEnviado: false,
  hablo: true,
  yaLeHablamos: true,
  primerPrecioAt: null,
  primerSalienteAt: null,
  respuestaAt: null,
  ultimoEntranteAt: null,
  primerAt: null,
};

describe("etapaDesde — de qué hecho sale la fecha", () => {
  test("cotizado por derivación se fecha con el PRIMER precio, no con el último", () => {
    const h: HechosDeEtapa = {
      ...NADA,
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(12),
      respuestaAt: hace(3),
      ultimoEntranteAt: hace(20),
    };
    assert.deepEqual(etapaDesde(h), hace(12));
  });

  test("contactado se fecha con el primer saliente POSTERIOR al último entrante", () => {
    // La persona escribió hace 4 días (volvió), le contestamos hace 3. Está
    // contactada desde hace 3 días — no desde la primera vez que le hablamos.
    const h: HechosDeEtapa = {
      ...NADA,
      respondida: true,
      ultimoEntranteAt: hace(4),
      respuestaAt: hace(3),
      primerAt: hace(40),
    };
    assert.deepEqual(etapaDesde(h), hace(3));
  });

  test("interesado se fecha con el último entrante: es el ÚLTIMO ingreso, no el primero", () => {
    // Ya le habíamos hablado y volvió a escribir: vuelve a ser deuda nuestra, y
    // la antigüedad se cuenta desde que volvió.
    const h: HechosDeEtapa = { ...NADA, ultimoEntranteAt: hace(2), primerAt: hace(30) };
    assert.deepEqual(etapaDesde(h), hace(2));
  });

  test("sin ningún entrante, interesado cae al primer mensaje", () => {
    assert.deepEqual(etapaDesde({ ...NADA, primerAt: hace(5) }), hace(5));
  });

  test("una etapa DECLARADA se fecha con su gestión", () => {
    // `perdido` es terminal humano: no hay hecho que lo derive.
    const h: HechosDeEtapa = {
      ...NADA,
      etapaManual: "perdido",
      gestionAt: hace(6),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(1),
    };
    assert.deepEqual(etapaDesde(h), hace(6));
  });

  test("«cierre» declarado se fecha con la gestión aunque el precio sea más viejo", () => {
    const h: HechosDeEtapa = {
      ...NADA,
      etapaManual: "cierre",
      gestionAt: hace(2),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(30),
    };
    assert.deepEqual(etapaDesde(h), hace(2));
  });

  test("🔴 con los dos hechos, gana EL MÁS VIEJO — no el declarado", () => {
    // El caso que un `if/else` con precedencia reportaría mal: el precio salió el
    // día 12 y alguien tocó «Cotizado» recién el día 3. Entró hace 12 días.
    const h: HechosDeEtapa = {
      ...NADA,
      etapaManual: "cotizado",
      gestionAt: hace(3),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(12),
    };
    assert.deepEqual(etapaDesde(h), hace(12), "la declaración no puede rejuvenecer un hecho anterior");
  });

  test("y al revés: declarada primero, hecho después, también gana la más vieja", () => {
    const h: HechosDeEtapa = {
      ...NADA,
      etapaManual: "cotizado",
      gestionAt: hace(20),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(4),
    };
    assert.deepEqual(etapaDesde(h), hace(20));
  });

  test("una gestión de OTRA etapa no fecha nada: la efectiva la puso el hecho", () => {
    // Manual `contactado` pero el precio ya salió → efectiva `cotizado`. La fecha
    // tiene que ser la del precio; la gestión habla de un peldaño que quedó atrás.
    const h: HechosDeEtapa = {
      ...NADA,
      etapaManual: "contactado",
      gestionAt: hace(25),
      respondida: true,
      precioEnviado: true,
      primerPrecioAt: hace(9),
    };
    assert.deepEqual(etapaDesde(h), hace(9));
  });

  test("las grafías viejas de `gestiones` se normalizan antes de comparar", () => {
    // 'venta' es como se guardaba `cierre` (normalizarEtapa). Sin normalizar, la
    // comparación fallaría y la fila saldría sin fecha.
    const h: HechosDeEtapa = { ...NADA, etapaManual: "venta", gestionAt: hace(7) };
    assert.deepEqual(etapaDesde(h), hace(7));
  });

  test("🔴 sin el hecho que la derivó, `null` — jamás una fecha inventada", () => {
    // El comentario de FB/IG respondido: sabemos que se respondió, no cuándo.
    const h: HechosDeEtapa = { ...NADA, respondida: true, respuestaAt: null };
    assert.equal(etapaDesde(h), null);
  });

  test("una gestión sin fecha no fabrica una: `null`", () => {
    assert.equal(etapaDesde({ ...NADA, etapaManual: "perdido", gestionAt: null }), null);
  });
});

describe("«sin respuesta» — le escribimos y nunca contestó", () => {
  /** Difusión pura: salió un mensaje nuestro y del otro lado nunca hubo nadie. */
  const difusion: HechosDeEtapa = {
    ...NADA,
    hablo: false,
    yaLeHablamos: true,
    // ⚠️ `respondida` es TRUE acá, y no es un error del fixture: sin ningún
    // entrante, el último saliente le gana a un '-infinity'. Es exactamente el
    // motivo por el que esta etapa tuvo que existir.
    respondida: true,
    primerSalienteAt: hace(9),
  };

  test("se fecha con el PRIMER saliente: el silencio corre desde que le escribimos", () => {
    assert.deepEqual(etapaDesde(difusion), hace(9));
  });

  test("🔴 y le gana al precio: un blast con precio no vuelve cotizado a nadie", () => {
    // El caso medido: el 5-ago salieron 1.139 mensajes contra 49 entrantes, y ese
    // envío promovió 2.252 conversaciones a Cotizados de una sola vez.
    const conPrecio = { ...difusion, precioEnviado: true, primerPrecioAt: hace(9) };
    assert.deepEqual(etapaDesde(conPrecio), hace(9));
    assert.equal(etapaEfectiva(null, true, true, false, true), "sin_respuesta");
  });

  test("insistir NO reinicia la espera: manda el primer saliente, no el último", () => {
    assert.deepEqual(etapaDesde({ ...difusion, primerSalienteAt: hace(20) }), hace(20));
  });

  test("en cuanto la persona escribe, deja de estar acá — sola", () => {
    assert.equal(etapaEfectiva(null, true, true, true, true), "cotizado");
  });

  test("una gestión asentada le gana: está en el FONDO de la escala", () => {
    assert.equal(etapaEfectiva("contactado", true, false, false, true), "contactado");
    // Y entonces la fecha es la de la gestión, no la del primer saliente.
    assert.deepEqual(
      etapaDesde({ ...difusion, etapaManual: "contactado", gestionAt: hace(2) }),
      hace(2),
    );
  });

  test("sin ningún mensaje nuestro NO es «sin respuesta»: no hay silencio que contar", () => {
    assert.equal(etapaEfectiva(null, false, false, false, false), "interesado");
  });

  test("🔴 no es declarable: `perdido` y `cierre` siguen ganando siempre", () => {
    assert.equal(etapaEfectiva("perdido", true, true, false, true), "perdido");
    assert.equal(etapaEfectiva("cierre", true, true, false, true), "cierre");
  });
});

describe("paraSeguir — el recorte que convierte la pila en lista", () => {
  /** Una cotizada por derivación, con la antigüedad que se pida. */
  const cotizadaHace = (dias: number, respondida = true): HechosDeEtapa => ({
    ...NADA,
    respondida,
    precioEnviado: true,
    primerPrecioAt: hace(dias),
  });

  test("entra la que lleva más de 3 días en silencio", () => {
    assert.equal(paraSeguir(cotizadaHace(5), AHORA), true);
  });

  test("no entra la de ayer: todavía no es hora de insistir", () => {
    assert.equal(paraSeguir(cotizadaHace(1), AHORA), false);
  });

  test("no entra la de hace un mes: el techo la deja fuera", () => {
    assert.equal(paraSeguir(cotizadaHace(30), AHORA), false);
  });

  test("🔴 si CONTESTARON, no es seguimiento: la pelota es nuestra", () => {
    // `respondida: false` = el último movimiento fue de la persona. Eso es deuda,
    // y la deuda la ordena la urgencia — no este recorte.
    assert.equal(paraSeguir(cotizadaHace(5, false), AHORA), false);
  });

  test("sin fecha de ingreso no se puede decidir, y no se adivina", () => {
    assert.equal(paraSeguir({ ...NADA, respondida: true }, AHORA), false);
  });

  test("los bordes son los de las constantes, y son cerrado-abierto", () => {
    assert.equal(paraSeguir(cotizadaHace(SEGUIR_DESDE_DIAS), AHORA), true, "a los 3 días justos entra");
    assert.equal(
      paraSeguir(cotizadaHace(SEGUIR_HASTA_DIAS), AHORA),
      false,
      "a los 14 días justos ya salió",
    );
    // Sin solapamiento ni hueco: cada conversación cae de un solo lado.
    assert.ok(SEGUIR_DESDE_DIAS < SEGUIR_HASTA_DIAS);
  });

  test("el reloj se inyecta: la misma conversación entra hoy y sale en un mes", () => {
    const h = cotizadaHace(5);
    assert.equal(paraSeguir(h, AHORA), true);
    assert.equal(paraSeguir(h, new Date(AHORA.getTime() + 30 * DIA)), false);
  });
});
