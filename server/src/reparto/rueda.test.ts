import { describe, it } from "node:test";
import assert from "node:assert";
import { siguienteEnLaRueda, simularReparto, type EnLaRueda } from "./rueda.js";

const rueda = (...nombres: string[]): EnLaRueda[] =>
  nombres.map((vendedoraId, i) => ({ vendedoraId, asignadas: 0, orden: i }));

const LOS_SEIS = rueda("ana", "beto", "caro", "dani", "eva", "fer");

describe("siguienteEnLaRueda", () => {
  it("con todos en cero, le toca al primero por orden", () => {
    assert.equal(siguienteEnLaRueda(LOS_SEIS), "ana");
  });

  it("le toca al que MENOS tiene, no al siguiente de la lista", () => {
    const estado: EnLaRueda[] = [
      { vendedoraId: "ana", asignadas: 3, orden: 0 },
      { vendedoraId: "beto", asignadas: 1, orden: 1 },
      { vendedoraId: "caro", asignadas: 2, orden: 2 },
    ];
    assert.equal(siguienteEnLaRueda(estado), "beto");
  });

  /**
   * El desempate tiene que ser ESTABLE. Sin `orden`, dos personas con la misma
   * carga se ordenarían por lo que devuelva la base —que no promete orden— y el
   * mismo estado daría resultados distintos en dos corridas. Un reparto que no
   * es reproducible no se puede auditar, y auditable es media razón por la que
   * se eligió round-robin sobre azar.
   */
  it("el empate lo resuelve el orden, no la base", () => {
    const a: EnLaRueda[] = [
      { vendedoraId: "zoe", asignadas: 2, orden: 5 },
      { vendedoraId: "ana", asignadas: 2, orden: 0 },
    ];
    assert.equal(siguienteEnLaRueda(a), "ana");
    // El mismo estado, en el orden inverso de la lista: mismo resultado.
    assert.equal(siguienteEnLaRueda([...a].reverse()), "ana");
  });

  /**
   * FAIL-OPEN. Que no haya nadie no es un error: la conversación queda sin
   * dueño, que es el comportamiento de antes de este frente. Asignársela a
   * alguien inventado sería peor.
   */
  it("sin nadie en la rueda devuelve null, no explota", () => {
    assert.equal(siguienteEnLaRueda([]), null);
  });

  it("con una sola persona, siempre le toca a ella", () => {
    assert.equal(siguienteEnLaRueda(rueda("ana")), "ana");
  });
});

describe("simularReparto — la propiedad que se le promete al equipo", () => {
  /**
   * LA PROPIEDAD: entre el que más y el que menos recibe **nunca hay más de 1**.
   *
   * Esto es lo que se dijo cuando se eligió round-robin sobre azar, así que es
   * lo que hay que fijar con un test. Al azar, estos mismos números pueden dar
   * 4 y 0 — y esa diferencia se lee como favoritismo.
   */
  it("reparte parejo: la diferencia máxima es 1", () => {
    for (const cuantas of [1, 5, 6, 7, 10, 23, 100]) {
      const carga = [...simularReparto(LOS_SEIS, cuantas).values()];
      const dif = Math.max(...carga) - Math.min(...carga);
      assert.ok(dif <= 1, `con ${cuantas} leads la diferencia fue ${dif}, no 0 ni 1`);
    }
  });

  it("con 10 leads entre 6, cuatro reciben 2 y dos reciben 1 — nadie queda en cero", () => {
    const carga = simularReparto(LOS_SEIS, 10);
    assert.equal([...carga.values()].reduce((a, b) => a + b, 0), 10);
    assert.ok(![...carga.values()].includes(0), "nadie puede quedarse sin ninguna");
  });

  /**
   * El caso que justifica elegir por carga en vez de un puntero: alguien se suma
   * tarde. Con un puntero habría que reiniciarlo a mano; acá **se empareja solo**.
   */
  it("quien entra tarde recibe hasta emparejar, sin reiniciar nada", () => {
    const conRezagado: EnLaRueda[] = [
      { vendedoraId: "ana", asignadas: 5, orden: 0 },
      { vendedoraId: "beto", asignadas: 5, orden: 1 },
      { vendedoraId: "nueva", asignadas: 0, orden: 2 },
    ];
    const carga = simularReparto(conRezagado, 5);
    assert.equal(carga.get("nueva"), 5, "las cinco van a la que estaba en cero");
    assert.equal(carga.get("ana"), 5);
  });

  it("sin nadie en la rueda no reparte y no cuelga", () => {
    assert.equal(simularReparto([], 10).size, 0);
  });
});
