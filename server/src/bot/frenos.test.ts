import { describe, it } from "node:test";
import assert from "node:assert";
import {
  esEntranteRepetido,
  vendedoraActivaDesde,
  yaLeRespondimos,
  REPETICIONES_PARA_SPAM,
} from "./frenos.js";

const T = (iso: string) => new Date(iso);

describe("vendedoraActivaDesde — el freno que estaba clavado en null", () => {
  it("una vendedora que contestó DESPUÉS del último mensaje del lead toma la conversación", () => {
    const r = vendedoraActivaDesde(T("2026-08-01T15:00:00Z"), T("2026-08-01T14:00:00Z"));
    assert.deepStrictEqual(r, T("2026-08-01T15:00:00Z"));
  });

  it("🔴 si el lead volvió a escribir DESPUÉS de la vendedora, la conversación queda libre", () => {
    // Este es el caso que obliga a comparar en vez de preguntar «¿hay?»: sin la
    // comparación, una sola intervención humana en marzo dejaba al bot mudo
    // para siempre en esa conversación.
    const r = vendedoraActivaDesde(T("2026-08-01T14:00:00Z"), T("2026-08-01T15:00:00Z"));
    assert.strictEqual(r, null);
  });

  it("sin ningún envío humano, no hay vendedora activa", () => {
    assert.strictEqual(vendedoraActivaDesde(null, T("2026-08-01T15:00:00Z")), null);
  });

  it("hubo humana y no se sabe cuándo escribió el lead: gana la humana", () => {
    // «No se sabe» no puede resolverse a favor de que el bot hable encima.
    const r = vendedoraActivaDesde(T("2026-08-01T15:00:00Z"), null);
    assert.deepStrictEqual(r, T("2026-08-01T15:00:00Z"));
  });

  it("empate exacto: gana la persona", () => {
    const mismo = T("2026-08-01T15:00:00Z");
    assert.deepStrictEqual(vendedoraActivaDesde(mismo, new Date(mismo)), mismo);
  });
});

describe("esEntranteRepetido — repetir no es spam si nadie contestó", () => {
  const tresIguales = ["hola", "hola", "hola"];

  it("🔴 tres «hola» SIN respuesta nuestra NO es spam: es un lead impaciente", () => {
    // La decisión comercial del módulo. Callarse acá pierde justo al lead que
    // más ganas tiene de que le contesten.
    assert.strictEqual(esEntranteRepetido(tresIguales, false), false);
  });

  it("tres iguales DESPUÉS de habernos respondido sí frena", () => {
    assert.strictEqual(esEntranteRepetido(tresIguales, true), true);
  });

  it("dos iguales no alcanzan: dos es insistencia normal", () => {
    assert.strictEqual(esEntranteRepetido(["hola", "hola"], true), false);
    assert.strictEqual(REPETICIONES_PARA_SPAM, 3);
  });

  it("solo cuentan los ÚLTIMOS tres: un repetido viejo no condena la conversación", () => {
    const historia = ["hola", "hola", "hola", "¿cuánto cuesta?"];
    assert.strictEqual(esEntranteRepetido(historia, true), false);
  });

  it("la puntuación, las mayúsculas y los acentos no salvan de la repetición", () => {
    assert.strictEqual(esEntranteRepetido(["Hola!", "hola", "HOLA..."], true), true);
  });

  it("mensajes distintos no son repetición aunque se parezcan", () => {
    assert.strictEqual(
      esEntranteRepetido(["hola", "hola?", "cuanto cuesta"], true),
      false,
    );
  });

  it("textos que se normalizan a vacío (solo emojis o signos) no cuentan como repetición", () => {
    // Tres «...» seguidos se normalizan a cadena vacía; con menos de tres
    // candidatos reales no hay veredicto de spam.
    assert.strictEqual(esEntranteRepetido(["...", "!!!", "???"], true), false);
  });

  it("sin historial no hay repetición", () => {
    assert.strictEqual(esEntranteRepetido([], true), false);
  });
});

describe("yaLeRespondimos", () => {
  it("un hilo con un saliente dice que sí", () => {
    assert.strictEqual(
      yaLeRespondimos([{ direccion: "entrante" }, { direccion: "saliente" }]),
      true,
    );
  });

  it("un hilo de puros entrantes dice que no", () => {
    assert.strictEqual(
      yaLeRespondimos([{ direccion: "entrante" }, { direccion: "entrante" }]),
      false,
    );
  });

  it("un hilo vacío dice que no", () => {
    assert.strictEqual(yaLeRespondimos([]), false);
  });
});
