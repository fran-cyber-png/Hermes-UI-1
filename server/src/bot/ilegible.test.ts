import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ACUSE_POR_CLASE,
  CLASES_ILEGIBLES,
  claseIlegible,
  decidirAcuseIlegible,
  esUnAcuse,
} from "./ilegible.js";
import { validarSalida } from "./guardrails.js";
import { trocear } from "./chunker.js";

const conSaliente = (texto: string) => [
  { direccion: "entrante", texto: "hola" },
  { direccion: "saliente", texto },
];

describe("decidirAcuseIlegible — el lead deja de quedarse en silencio", () => {
  test("un audio sin acuse previo recibe el suyo", () => {
    const d = decidirAcuseIlegible(conSaliente("Te cuento del diploma…"), "audio");
    assert.equal(d.acusa, true);
    assert.equal(d.acusa && d.texto, ACUSE_POR_CLASE.audio);
  });

  test("una conversación sin ningún saliente también recibe acuse", () => {
    // El primer mensaje de alguien puede ser una nota de voz. Callarse ahí es
    // perder al lead antes de decirle una palabra.
    const d = decidirAcuseIlegible([{ direccion: "entrante", texto: null }], "audio");
    assert.equal(d.acusa, true);
  });

  test("cada clase trae SU texto: un sticker no se contesta como un audio", () => {
    const sticker = decidirAcuseIlegible([], "sticker");
    const audio = decidirAcuseIlegible([], "audio");
    assert.notEqual(sticker.acusa && sticker.texto, audio.acusa && audio.texto);
  });

  test("tres stickers seguidos reciben UN acuse, no tres", () => {
    // El segundo llega con nuestro acuse como último saliente: no se repite.
    const d = decidirAcuseIlegible(conSaliente(ACUSE_POR_CLASE.sticker), "sticker");
    assert.equal(d.acusa, false);
    assert.equal(d.acusa === false && d.motivo, "ya_lo_pedimos");
  });

  test("tampoco se repite si el anterior fue de OTRA clase", () => {
    // Audio y después foto: ya le pedimos que lo escriba, y no escribió.
    const d = decidirAcuseIlegible(conSaliente(ACUSE_POR_CLASE.audio), "imagen");
    assert.equal(d.acusa, false);
  });

  test("si en el medio el bot contestó de verdad, un sticker nuevo vuelve a merecer acuse", () => {
    // Es otro episodio, no insistencia: el lead escribió, el bot le respondió, y
    // recién ahí mandó el sticker.
    const hilo = [
      { direccion: "saliente", texto: ACUSE_POR_CLASE.sticker },
      { direccion: "entrante", texto: "quiero info" },
      { direccion: "saliente", texto: "¡Claro! Te cuento…" },
    ];
    assert.equal(decidirAcuseIlegible(hilo, "sticker").acusa, true);
  });

  test("un saliente sin texto (una imagen nuestra) no cuenta como acuse", () => {
    assert.equal(decidirAcuseIlegible(conSaliente(""), "sticker").acusa, true);
  });
});

describe("claseIlegible — lo desconocido cae en `otro`, nunca revienta", () => {
  test("traduce las clases que el transporte declara", () => {
    assert.equal(claseIlegible("sticker"), "sticker");
    assert.equal(claseIlegible("documento"), "documento");
  });

  test("una clase que Meta agregue mañana no rompe: cae en `otro`", () => {
    assert.equal(claseIlegible("ubicacion"), "otro");
    assert.equal(claseIlegible(null), "otro");
    assert.equal(claseIlegible(undefined), "otro");
  });
});

describe("los textos pasan el MISMO guardrail que lo que escribe el modelo", () => {
  for (const clase of CLASES_ILEGIBLES) {
    test(`«${clase}» no viola ninguna regla de salida`, () => {
      const v = validarSalida(ACUSE_POR_CLASE[clase]);
      assert.equal(v.ok, true, v.ok ? "" : `${v.violacion}: ${v.detalle}`);
    });
  }

  test("ninguno se anuncia como máquina ni promete que otro te va a contactar", () => {
    // La regla del dueño del 27-jul y la prohibición #1 de §6, verificadas sobre
    // el texto literal: el guardrail ya las cubre, pero estas dos son las que
    // más tienta escribir en un mensaje de disculpa.
    const prohibidas = ["automátic", "bot", "sistema", "asesor", "te contactar"];
    for (const clase of CLASES_ILEGIBLES) {
      const plano = ACUSE_POR_CLASE[clase].toLowerCase();
      for (const p of prohibidas) {
        assert.equal(plano.includes(p), false, `«${clase}» dice «${p}»`);
      }
    }
  });

  test("cada acuse entra en UNA burbuja — de eso depende no repetirlo", () => {
    // `decidirAcuseIlegible` reconoce el acuse comparando el ÚLTIMO saliente. Si
    // el chunker lo partiera en dos, el último sería la segunda mitad, no
    // matchearía, y el lead recibiría un acuse por cada sticker.
    for (const clase of CLASES_ILEGIBLES) {
      const burbujas = trocear(ACUSE_POR_CLASE[clase]);
      assert.equal(burbujas.length, 1, `«${clase}» se parte en ${burbujas.length}`);
      assert.equal(esUnAcuse(burbujas[0]!), true);
    }
  });
});

describe("esUnAcuse", () => {
  test("reconoce el texto tal como salió, con espacios de más", () => {
    assert.equal(esUnAcuse(`  ${ACUSE_POR_CLASE.audio}  `), true);
  });

  test("no confunde una respuesta normal con un acuse", () => {
    assert.equal(esUnAcuse("Claro, el diploma dura 8 sesiones"), false);
    assert.equal(esUnAcuse(null), false);
  });
});
