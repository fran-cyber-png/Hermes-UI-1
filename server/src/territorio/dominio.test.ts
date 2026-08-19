import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  claveDistrito,
  distritoAjeno,
  motivoParaNoAceptar,
  ordenarDistritos,
  type Distrito,
} from "./dominio.js";

const d = (id: number, nombre: string, orden = 0): Distrito => ({ id, nombre, zona: null, orden });

describe("la llave de un distrito", () => {
  /**
   * 🔴 Tiene que decir EXACTAMENTE lo mismo que `distrito_linea_nombre_uq`
   * (`lower(btrim(nombre))`). Si divergen, el alta acepta un nombre que la base
   * rechaza — o, peor, entran dos filas que en la pantalla se ven iguales y la
   * campaña reparte su gente entre las dos.
   */
  test("normaliza caja y espacios, como el índice único", () => {
    assert.equal(claveDistrito("San Isidro"), "san isidro");
    assert.equal(claveDistrito("  SAN ISIDRO  "), "san isidro");
    assert.equal(claveDistrito("san isidro"), "san isidro");
  });

  test("⚠️ NO saca acentos: «Ancón» y «Ancon» son dos lugares distintos de escribir", () => {
    // Quitarlos acá haría que el índice único de la base y esto discrepen, y el
    // alta empezaría a fallar con un error de Postgres en vez de un mensaje.
    assert.notEqual(claveDistrito("Ancón"), claveDistrito("Ancon"));
  });
});

describe("qué nombre se acepta", () => {
  test("uno normal pasa", () => {
    assert.equal(motivoParaNoAceptar("San Juan de Lurigancho"), null);
  });

  test("⚠️ vacío y sólo espacios se RECHAZAN, no se arreglan", () => {
    assert.ok(motivoParaNoAceptar(""));
    assert.ok(motivoParaNoAceptar("   "));
  });

  test("⚠️ uno larguísimo se rechaza en vez de recortarse", () => {
    // Recortar escribe una fila que después nadie identifica en el selector.
    assert.ok(motivoParaNoAceptar("x".repeat(81)));
    assert.equal(motivoParaNoAceptar("x".repeat(80)), null);
  });
});

describe("el orden del catálogo", () => {
  test("manda `orden`, y a igualdad el nombre", () => {
    const r = ordenarDistritos([d(1, "Zárate", 2), d(2, "Comas", 1), d(3, "Ate", 1)]);
    assert.deepEqual(r.map((x) => x.nombre), ["Ate", "Comas", "Zárate"]);
  });

  /**
   * 🔴 El desempate no es cosmético: con `orden` en 0 para todos —el default y
   * el caso normal al sembrar— sin él el orden lo pondría la base, que no lo
   * promete, y el selector cambiaría entre dos aperturas.
   */
  test("con todo en 0 sigue siendo estable y alfabético", () => {
    const r = ordenarDistritos([d(1, "Villa El Salvador"), d(2, "Ate"), d(3, "Miraflores")]);
    assert.deepEqual(r.map((x) => x.nombre), ["Ate", "Miraflores", "Villa El Salvador"]);
  });

  test("⚠️ ordena en español: «Áncash» no se va al final", () => {
    const r = ordenarDistritos([d(1, "Zorritos"), d(2, "Áncash"), d(3, "Barranco")]);
    assert.deepEqual(r.map((x) => x.nombre), ["Áncash", "Barranco", "Zorritos"]);
  });

  test("no muta la lista que recibe", () => {
    const original = [d(1, "Zárate"), d(2, "Ate")];
    ordenarDistritos(original);
    assert.deepEqual(original.map((x) => x.nombre), ["Zárate", "Ate"]);
  });
});

describe("la guarda del destino", () => {
  const catalogo = [d(1, "Ate"), d(2, "Comas")];

  test("un distrito del catálogo propio pasa", () => {
    assert.equal(distritoAjeno(1, catalogo), false);
  });

  /**
   * 🔴 Un `distritoId` de OTRA campaña es un número válido, escribe una fila
   * válida, y nadie se entera: la persona queda anotada en un distrito que su
   * propia pantalla no muestra y del otro lado engorda un conteo ajeno. Es la
   * misma lección de `reparto/destino.ts` y `padron/destinos.ts`.
   */
  test("🔴 uno de otro catálogo NO pasa", () => {
    assert.equal(distritoAjeno(99, catalogo), true);
  });

  test("con el catálogo vacío no pasa ninguno", () => {
    // Sin migración `catalogoDe` devuelve `[]`: ahí lo correcto es rechazar todo,
    // no dejar escribir contra una tabla que no existe.
    assert.equal(distritoAjeno(1, []), true);
  });
});
