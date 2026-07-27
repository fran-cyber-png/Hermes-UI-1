import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  PREFIJO_VERSION,
  normalizarContenido,
  versionDeContenido,
  versionDeUnMensaje,
  versionDeUnaSecuencia,
  versionLegible,
} from "./version.js";
import {
  PASO_FLYER,
  PASO_FLYER_AGOSTO,
  PASO_PRECIO,
  VECTORES_DE_MENSAJE,
  VECTORES_DE_SECUENCIA,
} from "./vectores.js";

describe("la receta de versión, contra sus vectores literales", () => {
  for (const v of VECTORES_DE_MENSAJE) {
    test(`${v.nombre} → ${v.version}`, () => {
      assert.equal(versionDeUnMensaje(v.contenido), v.version);
    });
  }

  for (const v of VECTORES_DE_SECUENCIA) {
    test(`${v.nombre} → ${v.version}`, () => {
      assert.equal(versionDeUnaSecuencia(v.pasos), v.version);
      assert.deepEqual(v.pasos.map(versionDeUnMensaje), [...v.versionesDePaso]);
    });
  }
});

describe("qué cuenta como una versión nueva", () => {
  test("EL FLYER ENTRA: cambiar la imagen es contenido nuevo, aunque el texto no se toque", () => {
    // Es el bug que motivó unificar: el catálogo hasheaba `media_clase` (la
    // cadena "imagen"), así que cambiar flyer-julio.jpg por
    // flyer-agosto-PRECIO-NUEVO.jpg dejaba la versión IDÉNTICA. En Goberna el
    // precio y las fechas viven adentro de la imagen: los resultados de dos
    // ofertas distintas se habrían sumado bajo la misma versión.
    assert.equal(PASO_FLYER.texto, PASO_FLYER_AGOSTO.texto, "el texto es el mismo a propósito");
    assert.notEqual(
      versionDeUnMensaje(PASO_FLYER),
      versionDeUnMensaje(PASO_FLYER_AGOSTO),
      "cambiar el flyer TIENE que cambiar la versión",
    );
  });

  test("y arrastra a la secuencia entera: la plantilla que lo contiene también cambia", () => {
    assert.notEqual(
      versionDeUnaSecuencia([PASO_FLYER, PASO_PRECIO]),
      versionDeUnaSecuencia([PASO_FLYER_AGOSTO, PASO_PRECIO]),
    );
  });

  test("la clase de media NO alcanza para distinguir: por eso no es lo que se hashea", () => {
    // La prueba de que hashear `media_clase` era ciego: los dos pasos son
    // "imagen" y son contenidos distintos.
    const a = versionDeUnMensaje({ texto: "mirá", archivo: "uno.jpg" });
    const b = versionDeUnMensaje({ texto: "mirá", archivo: "otro.jpg" });
    assert.notEqual(a, b);
    assert.equal(versionDeUnMensaje({ texto: "mirá", archivo: "imagen" }).length, a.length);
  });

  test("CRLF y bordes NO son una versión nueva: un editor de Windows no parte la historia", () => {
    assert.equal(
      versionDeUnMensaje({ texto: "hola\nchau" }),
      versionDeUnMensaje({ texto: "hola\r\nchau" }),
    );
    assert.equal(
      versionDeUnMensaje({ texto: "Se puede en cuotas" }),
      versionDeUnMensaje({ texto: "  Se puede en cuotas\n" }),
    );
  });

  test("un espacio de ADENTRO sí lo es — eso ya es editar el texto", () => {
    assert.notEqual(
      versionDeUnMensaje({ texto: "dos espacios" }),
      versionDeUnMensaje({ texto: "dos  espacios" }),
    );
  });

  test("el texto y el archivo no se pueden confundir entre sí", () => {
    // Sin delimitar las partes, `["ab",""]` y `["a","b"]` colisionarían y dos
    // piezas distintas quedarían con la misma versión.
    assert.notEqual(
      versionDeUnMensaje({ texto: "ab", archivo: null }),
      versionDeUnMensaje({ texto: "a", archivo: "b" }),
    );
  });

  test("una parte VACÍA no es lo mismo que una parte AUSENTE", () => {
    // Un paso vacío al final de una secuencia la cambia: la persona recibe un
    // mensaje más. Si las dos hashearan igual, agregar o sacar ese paso sería
    // invisible para el lazo.
    assert.notEqual(versionDeContenido(["a"]), versionDeContenido(["a", ""]));
  });

  test("la secuencia depende del ORDEN de los pasos", () => {
    assert.notEqual(
      versionDeUnaSecuencia([PASO_FLYER, PASO_PRECIO]),
      versionDeUnaSecuencia([PASO_PRECIO, PASO_FLYER]),
    );
  });
});

describe("la forma del valor", () => {
  test("lleva el prefijo del algoritmo y 16 hex — 23 caracteres, entra en un log", () => {
    const v = versionDeUnMensaje({ texto: "x" });
    assert.match(v, /^sha256:[0-9a-f]{16}$/);
    assert.equal(v.length, PREFIJO_VERSION.length + 16);
  });

  test("es TOTAL: el contenido vacío tiene versión, no `null`", () => {
    // «Vacío» y «no sabemos qué texto era» son cosas distintas. Confundirlas era
    // una de las cuatro divergencias entre el catálogo y el lazo.
    assert.match(versionDeUnMensaje({ texto: "" }), /^sha256:/);
    assert.match(versionDeContenido([]), /^sha256:/);
  });

  test("`versionLegible` saca el prefijo — no recorta a 8, que daba «sha256:x» siempre", () => {
    const v = versionDeUnMensaje({ texto: "x" });
    assert.equal(versionLegible(v), v.slice(PREFIJO_VERSION.length));
    assert.equal(versionLegible(v).length, 16);
    assert.equal(versionLegible(null), "sin-versión");
  });

  test("normalizarContenido aguanta null y undefined", () => {
    assert.equal(normalizarContenido(null), "");
    assert.equal(normalizarContenido(undefined), "");
  });
});
