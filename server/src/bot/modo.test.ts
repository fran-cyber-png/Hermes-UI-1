import { describe, it } from "node:test";
import assert from "node:assert";
import {
  DESCRIPCION_MODO,
  MODOS_BOT,
  MODO_POR_DEFECTO,
  esModoBot,
  modoValido,
} from "./modo.js";
import { decidir, type HechosParaDecidir } from "./decision.js";

describe("modoValido", () => {
  it("los tres modos pasan tal cual", () => {
    for (const m of MODOS_BOT) assert.strictEqual(modoValido(m), m);
  });

  it("🔴 un modo que no existe NO se cuela: cae al default y avisa", () => {
    // El bug que esto cierra: `config.ts` hacía `as "sombra" | "automatico"`
    // sobre lo que viniera del entorno. `BOT_MODO=automatiko` pasaba el cast,
    // llegaba al motor de decisión como un modo inexistente, ninguna rama lo
    // atrapaba y el bot quedaba ni apagado ni automático — sin un aviso.
    const avisos: string[] = [];
    assert.strictEqual(modoValido("automatiko", "sombra", (m) => avisos.push(m)), "sombra");
    assert.strictEqual(avisos.length, 1);
    assert.ok(avisos[0]!.includes("automatiko"), "el aviso nombra el valor que no sirvió");
  });

  it("ausente NO avisa: es el caso normal, no un error", () => {
    const avisos: string[] = [];
    const avisar = (m: string) => avisos.push(m);
    assert.strictEqual(modoValido(undefined, "sombra", avisar), "sombra");
    assert.strictEqual(modoValido(null, "sombra", avisar), "sombra");
    assert.strictEqual(modoValido("", "sombra", avisar), "sombra");
    assert.strictEqual(avisos.length, 0);
  });

  it("tolera espacios y mayúsculas: `  AUTOMATICO ` es automatico", () => {
    assert.strictEqual(modoValido("  AUTOMATICO "), "automatico");
  });

  it("el default de la casa es sombra: arrancar mandando nunca es el default", () => {
    assert.strictEqual(MODO_POR_DEFECTO, "sombra");
    assert.strictEqual(modoValido("cualquier cosa"), "sombra");
  });

  it("esModoBot rechaza lo que no es string", () => {
    assert.strictEqual(esModoBot(1), false);
    assert.strictEqual(esModoBot(null), false);
    assert.strictEqual(esModoBot("apagado"), true);
  });

  it("cada modo tiene descripción: agregar uno sin describirlo no compila", () => {
    for (const m of MODOS_BOT) assert.ok(DESCRIPCION_MODO[m].length > 10);
  });
});

describe("paridad con decision.ts — los dos hablan del mismo vocabulario", () => {
  it("los tres modos son aceptados por `decidir` sin caer en un estado fantasma", () => {
    // La relación que este test fija: `MODOS_BOT` y el `modo` que `decidir()`
    // sabe manejar tienen que ser el mismo conjunto. Si alguien agrega un modo
    // acá y no lo contempla allá, el bot vuelve a quedar en un limbo.
    const base: HechosParaDecidir = {
      modo: "automatico",
      lineaHabilitada: true,
      pausa: null,
      huboSalienteHumanoDespuesDe: null,
      entranteEsRepetido: false,
      turnosHoy: 0,
      maxTurnosDia: 40,
      respuestasUltimaHoraLinea: 0,
      maxRespuestasHoraLinea: 60,
      transporteConectado: true,
      frenado: false,
    };

    assert.deepStrictEqual(decidir({ ...base, modo: "apagado" }), {
      accion: "saltar",
      motivo: "apagado",
    });
    assert.deepStrictEqual(decidir({ ...base, modo: "sombra" }), { accion: "responder" });
    assert.deepStrictEqual(decidir({ ...base, modo: "automatico" }), { accion: "responder" });
  });
});
