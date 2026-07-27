import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  A_MANO,
  CLASES_DE_PIEZA,
  VIAS_DE_PIEZA,
  columnasDeProcedencia,
  deUnAcuse,
  deUnDato,
  deUnPasoDePlantilla,
  esAMano,
  procedenciaDesdeColumnas,
  refDePieza,
  rotuloDePieza,
} from "./pieza.js";

/**
 * LA PROCEDENCIA ES UN HECHO — y `null` es la LÍNEA DE BASE, no un hueco.
 *
 * Estos tests fijan las dos cosas que hacen que el lazo de resultados no mienta:
 * que una pieza se identifique igual hoy y después del frente 2 (la unificación
 * del catálogo), y que «lo escribió la vendedora» sea un valor con nombre, no la
 * ausencia de uno.
 */

describe("la pieza se identifica por (clase, ref) — estable a través del frente 2", () => {
  test("un paso de secuencia: la ref lleva la plantilla Y el orden", () => {
    const p = deUnPasoDePlantilla({ plantillaId: 12, orden: 3, via: "panel-secuencias" });
    assert.equal(p.tipo, "pieza");
    assert.equal(p.clase, "paso");
    assert.equal(p.ref, "12#3");
    assert.equal(p.via, "panel-secuencias");
    assert.equal(p.editada, false);
  });

  test("dos pasos de la misma secuencia NO son la misma pieza", () => {
    const uno = deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-secuencias" });
    const dos = deUnPasoDePlantilla({ plantillaId: 12, orden: 2, via: "panel-secuencias" });
    assert.notEqual(refDePieza(uno), refDePieza(dos));
  });

  test("la MISMA pieza mandada por dos vías es la misma pieza", () => {
    // Es la razón de ser de la columna `via`: si la vía formara parte de la
    // identidad, «la secuencia 12 funciona» sería incontestable — quedaría
    // partida en dos piezas que nadie puede sumar.
    const sugerida = deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-sugerencia" });
    const elegida = deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-secuencias" });
    assert.equal(refDePieza(sugerida), refDePieza(elegida));
    assert.notEqual(sugerida.via, elegida.via);
  });

  test("un dato recomendado se identifica por su clave, que es estable al renombrar el rótulo", () => {
    const p = deUnDato({ clave: "cuotas", editada: false });
    assert.equal(p.clase, "dato");
    assert.equal(p.ref, "cuotas");
    assert.equal(p.via, "panel-datos");
  });

  test("un dato que la vendedora reescribió queda marcado como editado", () => {
    const p = deUnDato({ clave: "cuotas", editada: true });
    assert.equal(p.editada, true, "lo que salió no es la frase del catálogo, y el número no puede fingir que sí");
  });

  test("un acuse de la auto-respuesta lleva el id de su plantilla", () => {
    const p = deUnAcuse({ plantillaId: "fuera-de-horario-primer-contacto" });
    assert.equal(p.clase, "acuse");
    assert.equal(p.ref, "fuera-de-horario-primer-contacto");
    assert.equal(p.via, "automatica");
  });

  test("las clases y las vías son listas cerradas: un typo no entra a la base", () => {
    assert.deepEqual([...CLASES_DE_PIEZA], ["paso", "dato", "acuse"]);
    assert.deepEqual(
      [...VIAS_DE_PIEZA],
      ["panel-sugerencia", "panel-secuencias", "panel-datos", "automatica"],
    );
  });
});

describe("«a mano» es un valor, no la ausencia de uno", () => {
  test("A_MANO es la línea de base y se pregunta por su nombre", () => {
    assert.equal(A_MANO.tipo, "a-mano");
    assert.equal(esAMano(A_MANO), true);
    assert.equal(esAMano(deUnDato({ clave: "cuotas", editada: false })), false);
  });

  test("se lee en castellano, y dice lo que es", () => {
    assert.equal(rotuloDePieza(A_MANO), "escrito a mano (la línea de base)");
    assert.equal(rotuloDePieza(deUnDato({ clave: "cuotas", editada: false })), "dato · cuotas");
    assert.equal(
      rotuloDePieza(deUnPasoDePlantilla({ plantillaId: 7, orden: 2, via: "panel-sugerencia" })),
      "paso · 7#2",
    );
  });

  test("refDePieza de lo escrito a mano es null — y ese null ES el dato", () => {
    assert.equal(refDePieza(A_MANO), null);
  });
});

describe("las columnas: ida y vuelta sin perder nada", () => {
  test("una pieza va a cinco columnas y vuelve idéntica", () => {
    const p = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 3,
      via: "panel-sugerencia",
      momento: "cotizada",
    });
    const cols = columnasDeProcedencia(p);
    assert.deepEqual(cols, {
      piezaClase: "paso",
      piezaRef: "12#3",
      piezaVia: "panel-sugerencia",
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(procedenciaDesdeColumnas(cols), p);
  });

  test("lo escrito a mano deja las cuatro columnas de pieza en null — pero conserva el momento", () => {
    // El momento es lo que hace comparable la línea de base: «la vendedora
    // escribiendo a mano cuando la conversación estaba cotizada» es el rival
    // legítimo del dato de las cuotas, y sin el momento no se puede aparear.
    const cols = columnasDeProcedencia({ tipo: "a-mano", momento: "cotizada" });
    assert.deepEqual(cols, {
      piezaClase: null,
      piezaRef: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(procedenciaDesdeColumnas(cols), { tipo: "a-mano", momento: "cotizada" });
  });

  test("una fila vieja (todo null, de antes de este cambio) se lee como escrita a mano sin momento", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: null,
      piezaRef: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: null,
    });
    assert.deepEqual(leida, { tipo: "a-mano", momento: null });
  });

  test("una fila a medias (clase sin ref) NO se inventa una pieza: cae a la línea de base", () => {
    // No debería pasar nunca —los constructores son la única puerta— pero si
    // pasa, contarla como pieza le atribuiría a alguien un resultado ajeno.
    const leida = procedenciaDesdeColumnas({
      piezaClase: "paso",
      piezaRef: null,
      piezaVia: "panel-sugerencia",
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(leida, { tipo: "a-mano", momento: "cotizada" });
  });

  test("una clase que no conocemos tampoco se inventa (una fila de un Hermes más nuevo)", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: "pieza-del-futuro",
      piezaRef: "x",
      piezaVia: "panel-datos",
      piezaEditada: false,
      momentoVenta: null,
    });
    assert.equal(leida.tipo, "a-mano");
  });

  test("un momento que no está en el vocabulario compartido se descarta, no se guarda crudo", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: null,
      piezaRef: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: "inventado",
    });
    assert.equal(leida.momento, null);
  });
});
