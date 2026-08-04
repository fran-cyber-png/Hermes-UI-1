import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  CLASES_DE_PIEZA,
  direccionDesdeRef,
  esClaseDePieza,
  refDeDireccion,
  rotuloDeDireccion,
  type DireccionDePieza,
} from "./direccion.js";
import { VECTORES_DE_MENSAJE, VECTORES_DE_SECUENCIA } from "./vectores.js";

describe("el vocabulario de clases", () => {
  /**
   * SON CINCO, Y EN ESTE ORDEN — es contrato publicado a Ivi.
   *
   * `hsm` se sumó el 4-ago-2026 para las campañas por plantilla aprobada. Que
   * exista acá NO significa que Ivi vaya a elegir una: el catálogo que Ivi lee
   * no sirve piezas de esa clase, porque Ivi arma respuestas DENTRO de una
   * conversación viva y una HSM existe justamente para cuando no la hay.
   *
   * Vive en esta lista porque es donde tiene que vivir: es el vocabulario de
   * `envios_wa.pieza_clase`, y sin ella los envíos de campaña caerían en
   * `A_MANO` —la línea de base— y contaminarían el número contra el que se
   * compara todo lo demás.
   */
  test("son las cinco, y en este orden — es contrato publicado a Ivi", () => {
    assert.deepEqual([...CLASES_DE_PIEZA], ["plantilla", "hecho", "acuse", "gancho", "hsm"]);
  });

  test("no hay clase `paso` ni clase `dato`: eran los dos nombres del choque", () => {
    // El catálogo publicaba {clase:"plantilla"} y {clase:"hecho"}; el lazo
    // estampaba {clase:"paso"} y {clase:"dato"}. El mismo dato salía
    // `hecho:cuotas` de un lado y `dato:cuotas` del otro, y el join daba cero.
    assert.equal(esClaseDePieza("paso"), false);
    assert.equal(esClaseDePieza("dato"), false);
    assert.equal(esClaseDePieza("hecho"), true);
    assert.equal(esClaseDePieza("plantilla"), true);
  });

  test("una clase que no conocemos no es una clase", () => {
    assert.equal(esClaseDePieza("PLANTILLA"), false);
    assert.equal(esClaseDePieza(""), false);
    assert.equal(esClaseDePieza(null), false);
    assert.equal(esClaseDePieza(12), false);
  });
});

describe("la ref, contra sus vectores literales", () => {
  for (const v of VECTORES_DE_MENSAJE) {
    test(`${v.nombre} → «${v.ref}»`, () => {
      assert.equal(refDeDireccion(v.direccion), v.ref);
    });
  }

  for (const v of VECTORES_DE_SECUENCIA) {
    test(`${v.nombre} → «${v.ref}» y sus pasos`, () => {
      assert.equal(refDeDireccion({ clase: "plantilla", id: v.plantillaId }), v.ref);
      assert.deepEqual(
        v.pasos.map((_, i) =>
          refDeDireccion({ clase: "plantilla", id: v.plantillaId, orden: i + 1 }),
        ),
        [...v.refsDePaso],
      );
    });
  }
});

describe("el paso se direcciona DENTRO de su plantilla", () => {
  test("`12#3` es el paso 3 de la plantilla 12 — no una pieza con id propio", () => {
    // `plantilla_pasos.id` NO es estable (escribirPasos borra y reinserta), así
    // que el paso no puede tener id propio. `(plantilla_id, orden)` sí lo es:
    // tiene un `unique` en el schema. Es la forma que Ivi ya usa en su contrato
    // de ensamblado, `{id, orden}`.
    assert.deepEqual(direccionDesdeRef("plantilla", "12#3"), {
      clase: "plantilla",
      id: "12",
      orden: 3,
    });
  });

  test("sin `#` es la secuencia entera, que es lo que el catálogo publica", () => {
    assert.deepEqual(direccionDesdeRef("plantilla", "12"), { clase: "plantilla", id: "12" });
  });

  test("el ida y vuelta cierra para todo vector", () => {
    const todas: DireccionDePieza[] = [
      ...VECTORES_DE_MENSAJE.map((v) => v.direccion),
      ...VECTORES_DE_SECUENCIA.flatMap((v) => [
        { clase: "plantilla" as const, id: v.plantillaId },
        ...v.pasos.map((_, i) => ({
          clase: "plantilla" as const,
          id: v.plantillaId,
          orden: i + 1,
        })),
      ]),
    ];
    for (const d of todas) {
      assert.deepEqual(direccionDesdeRef(d.clase, refDeDireccion(d)), d, rotuloDeDireccion(d));
    }
  });

  test("solo `plantilla` admite `orden`: un hecho con `#` en la clave sigue entero", () => {
    // Si `direccionDesdeRef` partiera cualquier clase por `#`, un hecho llamado
    // `plan#b` se leería como el paso b de un hecho `plan` — una pieza que no
    // existe, con resultados que no son de nadie.
    assert.deepEqual(direccionDesdeRef("hecho", "plan#3"), { clase: "hecho", id: "plan#3" });
    assert.deepEqual(direccionDesdeRef("acuse", "a#1"), { clase: "acuse", id: "a#1" });
  });

  test("una cola que no es un entero positivo NO es un orden", () => {
    for (const ref of ["12#", "12#0", "12#x", "12#-1", "12#2.5", "12#03"]) {
      assert.deepEqual(direccionDesdeRef("plantilla", ref), { clase: "plantilla", id: ref }, ref);
    }
  });

  test("se corta por el ÚLTIMO `#`, así el ida y vuelta cierra con ids raros", () => {
    assert.deepEqual(direccionDesdeRef("plantilla", "a#b#3"), {
      clase: "plantilla",
      id: "a#b",
      orden: 3,
    });
    assert.equal(refDeDireccion({ clase: "plantilla", id: "a#b", orden: 3 }), "a#b#3");
  });

  test("un `#` al principio no parte nada: quedaría un id vacío", () => {
    assert.deepEqual(direccionDesdeRef("plantilla", "#3"), { clase: "plantilla", id: "#3" });
  });

  test("un `orden` en una clase que no tiene pasos se IGNORA, no se pega a la ref", () => {
    // Si se pegara, `refDeDireccion` daría `cuotas#2` y `direccionDesdeRef` lo
    // leería como el id literal `cuotas#2` — una pieza que no existe. El ida y
    // vuelta dejaría de cerrar justo donde importa: en la ref que se guarda.
    assert.equal(refDeDireccion({ clase: "hecho", id: "cuotas", orden: 2 }), "cuotas");
    assert.deepEqual(direccionDesdeRef("hecho", refDeDireccion({ clase: "hecho", id: "cuotas", orden: 2 })), {
      clase: "hecho",
      id: "cuotas",
    });
  });
});

describe("ante la duda, nada", () => {
  test("una clase desconocida devuelve null — no se le acredita a nadie", () => {
    assert.equal(direccionDesdeRef("paso", "12#3"), null);
    assert.equal(direccionDesdeRef("", "x"), null);
    assert.equal(direccionDesdeRef(null, "x"), null);
  });

  test("una ref vacía o que no es texto tampoco es una dirección", () => {
    assert.equal(direccionDesdeRef("hecho", ""), null);
    assert.equal(direccionDesdeRef("hecho", null), null);
    assert.equal(direccionDesdeRef("hecho", 12), null);
  });
});

describe("cómo se lee", () => {
  test("`clase:ref`, que es como Ivi nombra la pieza que recomienda", () => {
    assert.equal(rotuloDeDireccion({ clase: "hecho", id: "cuotas" }), "hecho:cuotas");
    assert.equal(
      rotuloDeDireccion({ clase: "plantilla", id: "12", orden: 3 }),
      "plantilla:12#3",
    );
  });
});
