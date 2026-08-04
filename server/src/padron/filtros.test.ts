import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esLoteCiego, filtrosSchema, POR_PAGINA_DEFAULT, POR_PAGINA_MAX } from "./filtros.js";

/** El contrato de los filtros, sin base: qué se acepta, qué se rechaza y qué queda por default. */

describe("los filtros del padrón", () => {
  test("sin nada, la primera página con el tamaño por default y los más recientes", () => {
    const f = filtrosSchema.parse({});
    assert.equal(f.pagina, 1);
    assert.equal(f.porPagina, POR_PAGINA_DEFAULT);
    assert.equal(f.orden, "recientes");
    assert.equal(f.q, undefined);
  });

  test("una página más grande que el tope se RECHAZA, no se recorta en silencio", () => {
    // Recortar callado le haría creer al supervisor que está mirando 5.000
    // contactos cuando la tabla muestra 200 — y el lote que reparta sería otro.
    assert.equal(filtrosSchema.safeParse({ porPagina: POR_PAGINA_MAX + 1 }).success, false);
    assert.equal(filtrosSchema.safeParse({ porPagina: 0 }).success, false);
  });

  test("un texto vacío se lee como filtro ausente, no como «que el nombre sea vacío»", () => {
    const f = filtrosSchema.parse({ q: "   ", pais: "" });
    assert.equal(f.q, undefined);
    assert.equal(f.pais, undefined);
  });

  test("los textos se recortan", () => {
    assert.equal(filtrosSchema.parse({ q: "  javier  " }).q, "javier");
  });

  test("una etapa que Hermes no conoce PASA — el vocabulario no se cierra", () => {
    // `stage` lo escribe icarus, que es otro repo y otro equipo. Un valor nuevo
    // del otro lado no puede volverse un 400 acá: devuelve cero filas, que es la
    // respuesta correcta. Mismo criterio que `TIPO_IVI` (ADR 0021).
    const f = filtrosSchema.parse({ etapa: "una_etapa_que_no_existe_todavia" });
    assert.equal(f.etapa, "una_etapa_que_no_existe_todavia");
  });

  test("un orden inventado sí se rechaza: cada uno es una columna, no texto libre", () => {
    assert.equal(filtrosSchema.safeParse({ orden: "por_dni" }).success, false);
  });

  test("los booleanos llegan como texto desde la query string", () => {
    const f = filtrosSchema.parse({ conVenta: "true", sinHabilitar: "true" });
    assert.equal(f.conVenta, true);
    assert.equal(f.sinHabilitar, true);
  });

  test("un texto larguísimo se rechaza (no se manda a un ILIKE)", () => {
    assert.equal(filtrosSchema.safeParse({ q: "a".repeat(500) }).success, false);
  });
});

describe("el aviso de lote ciego", () => {
  test("si el recorte entra en la página, se lo puede mirar entero", () => {
    assert.equal(esLoteCiego(50, 50), false);
    assert.equal(esLoteCiego(0, 50), false);
  });

  test("si el recorte no entra, la pantalla tiene que decirlo", () => {
    // No bloquea: la regla dura #7 pide que la lista esté A LA VISTA, y esto es
    // el dato para ese aviso. Repartir 4.000 contactos es decisión del supervisor.
    assert.equal(esLoteCiego(4000, 50), true);
  });
});
