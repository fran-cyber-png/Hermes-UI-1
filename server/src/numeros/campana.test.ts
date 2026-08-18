import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { atiendeUnaCampana, esVedadaParaMi, lineasVedadasPara, PROPOSITO_CAMPANA } from "./campana.js";

const campana = (vendedoras: string[]) => ({
  numero: "51963139984",
  proposito: PROPOSITO_CAMPANA,
  vendedoras,
});

describe("una línea de campaña sólo la ve quien la atiende", () => {
  test("lo que NO es de campaña no se le veda a nadie", () => {
    for (const proposito of ["vendedora", "escuela", "un_proposito_que_no_existe_todavia"]) {
      const linea = { numero: "51984429504", proposito, vendedoras: ["luz"] };
      assert.equal(esVedadaParaMi(linea, "alex"), false, proposito);
      assert.equal(esVedadaParaMi(linea, undefined), false, proposito);
    }
  });

  test("la de campaña la ve quien la atiende, y nadie más", () => {
    assert.equal(esVedadaParaMi(campana(["usuario2"]), "usuario2"), false);
    assert.equal(esVedadaParaMi(campana(["usuario2"]), "alex"), true);
  });

  test("🔴 EL ROL NO LA ABRE: acá no hay `veTodo` que pasarle", () => {
    // La firma es la garantía — no existe un parámetro que un supervisor pueda
    // llenar. Si algún día aparece, este test deja de compilar antes de fallar.
    assert.equal(esVedadaParaMi(campana(["usuario2"]), "alan"), true);
    assert.equal(esVedadaParaMi(campana(["usuario2"]), "usuario1"), true);
  });

  test("🔴 las dos grafías del mismo humano son la misma persona", () => {
    // En prod conviven `Luz` (lo empuja Cerberus) y `luz` (lo que se tipea al
    // entrar). Con comparación exacta, la dueña de la campaña pierde su campaña.
    assert.equal(esVedadaParaMi(campana(["Betto.Romero"]), "betto.romero"), false);
    assert.equal(esVedadaParaMi(campana(["  usuario2 "]), "USUARIO2"), false);
  });

  test("sin identidad se veda, nunca se abre", () => {
    assert.equal(esVedadaParaMi(campana(["usuario2"]), undefined), true);
    assert.equal(esVedadaParaMi(campana(["usuario2"]), "   "), true);
    // Y una fila con la vendedora vacía no convierte a nadie en dueño.
    assert.equal(esVedadaParaMi(campana([""]), ""), true);
  });

  test("una línea de campaña sin dueñas no es de nadie", () => {
    assert.equal(esVedadaParaMi(campana([]), "usuario2"), true);
  });

  test("lineasVedadasPara devuelve sólo los números, y sólo los vedados", () => {
    const lineas = [
      { numero: "51984429504", proposito: "vendedora", vendedoras: ["luz"] },
      { numero: "51963139984", proposito: PROPOSITO_CAMPANA, vendedoras: ["usuario2"] },
      { numero: "51900000000", proposito: PROPOSITO_CAMPANA, vendedoras: ["otra"] },
    ];
    assert.deepEqual(lineasVedadasPara(lineas, "usuario2"), ["51900000000"]);
    assert.deepEqual(lineasVedadasPara(lineas, "alex"), ["51963139984", "51900000000"]);
    assert.deepEqual(lineasVedadasPara(lineas, "luz"), ["51963139984", "51900000000"]);
    assert.deepEqual(lineasVedadasPara([], "alex"), []);
  });
});

test("atiendeUnaCampana: una sola línea de campaña alcanza, mezclada con las de la Escuela", () => {
  assert.equal(atiendeUnaCampana([{ proposito: PROPOSITO_CAMPANA }]), true);
  assert.equal(atiendeUnaCampana([{ proposito: "vendedora" }, { proposito: PROPOSITO_CAMPANA }]), true);
});

test("atiendeUnaCampana: sin líneas NO es de campaña — el default se comporta como antes", () => {
  // Una vendedora nueva, un token de servicio, una lectura vacía: el riel entero,
  // que es exactamente lo que pasaba antes de este frente.
  assert.equal(atiendeUnaCampana([]), false);
  assert.equal(atiendeUnaCampana(undefined), false);
  assert.equal(atiendeUnaCampana([{ proposito: "vendedora" }, { proposito: "escuela" }]), false);
});

test("🔴 atiendeUnaCampana y soloSusLineas son LA MISMA respuesta, no dos parecidas", async () => {
  // Estaban escritas dos veces con `PROPOSITO_CAMPANA` declarado en cada archivo.
  // Si alguien vuelve a separarlas, el recorte de la cola y las vistas del riel
  // empiezan a decidir distinto sobre la misma persona, sin que nada falle (#37).
  const { soloSusLineas } = await import("../cola/lineas.js");
  const casos = [
    [] as { proposito: string }[],
    [{ proposito: PROPOSITO_CAMPANA }],
    [{ proposito: "vendedora" }],
    [{ proposito: "vendedora" }, { proposito: PROPOSITO_CAMPANA }],
    [{ proposito: "escuela" }],
  ];
  for (const caso of casos) {
    assert.equal(soloSusLineas(caso), atiendeUnaCampana(caso), JSON.stringify(caso));
  }
});
