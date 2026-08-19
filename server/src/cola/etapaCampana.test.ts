import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ETAPAS_CAMPANA } from "../gestiones/registrarGestion.js";
import {
  ESCALA_CAMPANA,
  ESCALA_ETAPAS,
  escalaDe,
  etapaDerivada,
  etapaEfectiva,
  SIN_RESPUESTA,
} from "./etapaEfectivaSql.js";

/**
 * EL EMBUDO DE CAMPAÑA (ADR 0063) — y lo que este archivo existe para atrapar.
 *
 * 🔴 **El modo de fallar es MUDO y ya estaba armado antes de escribir una línea.**
 * `etapaEfectiva` resuelve con `escala.indexOf(manual) >= escala.indexOf(derivada)`
 * y **`indexOf` devuelve -1 para lo que no está en la escala**, o sea que manda el
 * piso. Con las etapas de campaña fuera de la escala, una vendedora declaraba
 * «Se comprometió» y la tarjeta volvía sola a «Contestaron»: sin error, sin log,
 * y sin forma de distinguirlo de «todavía no la moví».
 *
 * Los dos primeros tests son ese caso exacto, escritos desde el defecto y no
 * desde la feature.
 */

describe("una etapa declarada de campaña no se la come el piso", () => {
  test("🔴 «comprometido» sobrevive a la derivación", () => {
    // Contestó, así que el piso derivado es `contactado`. Lo declarado tiene que
    // ganar — es más avanzado en SU escala.
    assert.equal(
      etapaEfectiva("comprometido", true, false, true, true, false, "campana"),
      "comprometido",
    );
  });

  test("🔴 y en la escala de VENTAS la misma llamada devuelve el piso — el defecto, fijado", () => {
    // Esto NO es un bug: es la prueba de que el módulo importa. Si algún día
    // este assert empieza a devolver «comprometido», es que alguien metió las
    // etapas de campaña en `ETAPAS` y le cambió el ranking a la Escuela.
    assert.equal(etapaEfectiva("comprometido", true, false, true, true, false), "contactado");
  });

  test("el piso sigue empujando: declarar «simpatiza» sobre alguien que no contestó", () => {
    // `voluntario` es más avanzado que el piso, así que gana; al revés no.
    assert.equal(etapaEfectiva("voluntario", true, false, true, true, false, "campana"), "voluntario");
    assert.equal(etapaEfectiva("interesado", true, false, true, true, false, "campana"), "contactado");
  });

  test("«perdido» es terminal en los dos módulos", () => {
    assert.equal(etapaEfectiva("perdido", true, false, true, true, false, "campana"), "perdido");
    assert.equal(etapaEfectiva("perdido", true, true, true, true, true, "campana"), "perdido");
  });
});

describe("en campaña la derivación se corta en «contactó»", () => {
  test("🔴 una venta posterior NO asciende a «cierre»", () => {
    // `conversiones_wa` dice «esta persona compró alguna vez»: un teléfono que
    // además le compró un diplomado a la Escuela no cierra ninguna campaña.
    assert.equal(etapaDerivada(true, false, true, true, true, "campana"), "contactado");
    assert.equal(etapaDerivada(true, false, true, true, true), "cierre", "en ventas sí");
  });

  test("🔴 un precio en el hilo NO asciende a «cotizado»", () => {
    // Hablar de plata en una conversación de campaña no es haber cotizado nada.
    assert.equal(etapaDerivada(true, true, true, true, false, "campana"), "contactado");
    assert.equal(etapaDerivada(true, true, true, true, false), "cotizado", "en ventas sí");
  });

  test("el arranque SÍ se comparte: deriva de quién habló, no de plata", () => {
    for (const modulo of ["ventas", "campana"] as const) {
      assert.equal(etapaDerivada(false, false, false, true, false, modulo), SIN_RESPUESTA);
      assert.equal(etapaDerivada(true, false, true, true, false, modulo), "contactado");
      assert.equal(etapaDerivada(false, false, true, false, false, modulo), "interesado");
    }
  });

  test("🔴 ninguna etapa derivada puede caer FUERA de su escala", () => {
    // La invariante que hace imposible el -1. Se barren todas las combinaciones
    // de los cinco booleanos, en los dos módulos.
    for (const modulo of ["ventas", "campana"] as const) {
      const escala = escalaDe(modulo);
      for (let i = 0; i < 32; i++) {
        const b = (n: number) => Boolean(i & (1 << n));
        const derivada = etapaDerivada(b(0), b(1), b(2), b(3), b(4), modulo);
        assert.ok(
          escala.includes(derivada),
          `«${derivada}» se deriva en «${modulo}» y no está en su escala: rankearía -1`,
        );
      }
    }
  });
});

describe("las dos escalas", () => {
  test("comparten el arranque y difieren en la cola", () => {
    assert.deepEqual(ESCALA_CAMPANA.slice(0, 3), [SIN_RESPUESTA, "interesado", "contactado"]);
    assert.deepEqual(ESCALA_ETAPAS.slice(0, 3), [SIN_RESPUESTA, "interesado", "contactado"]);
    assert.deepEqual(ESCALA_CAMPANA.slice(3), ["simpatiza", "comprometido", "voluntario"]);
    assert.deepEqual(ESCALA_ETAPAS.slice(3), ["cotizado", "cierre"]);
  });

  test("ninguna de las dos lleva «perdido»: es terminal, no un peldaño", () => {
    assert.ok(!ESCALA_CAMPANA.includes("perdido"));
    assert.ok(!ESCALA_ETAPAS.includes("perdido"));
    assert.ok((ETAPAS_CAMPANA as readonly string[]).includes("perdido"), "declarable sí");
  });

  test("⚠️ `sin_respuesta` se deriva y NO se declara, tampoco en campaña", () => {
    assert.ok(ESCALA_CAMPANA.includes(SIN_RESPUESTA));
    assert.ok(
      !(ETAPAS_CAMPANA as readonly string[]).includes(SIN_RESPUESTA),
      "declarable haría que alguien afirme «nunca me contestó» sobre quien sí contestó",
    );
  });
});
