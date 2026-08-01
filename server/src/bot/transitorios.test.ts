import { describe, it } from "node:test";
import assert from "node:assert";
import { MOTIVOS_TRANSITORIOS, esTransitorio, type MotivoSalto } from "./decision.js";
import type { EstadoSesion } from "../whatsapp/transporte.js";

/**
 * LOS DOS DEFECTOS QUE, JUNTOS, DEJARON AL BOT DESCARTANDO TODOS LOS LEADS.
 *
 * Incidente del 1-ago-2026, ~20 minutos en producción:
 *
 *   1. El chequeo de transporte comparaba `String(estado())` —o sea
 *      `"[object Object]"`— contra `"conectado"`. Siempre falso. Mientras el
 *      valor se pasaba fijo en `true` nadie lo notó; al recolectarlo de verdad,
 *      TODO entrante se saltó con `desconectado`.
 *   2. Cualquier salto borraba el pendiente. Así que ese `desconectado` —una
 *      condición que dura segundos— **perdía el mensaje del lead para siempre**.
 *
 * Ninguno de los dos era visible por separado. Estos tests fijan los dos.
 */

describe("el estado de una sesión es un OBJETO, no una cadena", () => {
  it("🔴 String(estado) NUNCA es 'conectado' — el bug exacto", () => {
    const estado: EstadoSesion = { estado: "conectado", telefono: "51984429504" };
    assert.notStrictEqual(String(estado), "conectado");
    assert.strictEqual(String(estado), "[object Object]");
  });

  it("la lectura correcta es `.estado`", () => {
    const estado: EstadoSesion = { estado: "conectado", telefono: "51984429504" };
    assert.strictEqual(estado.estado, "conectado");
  });

  it("los otros estados también se leen igual — ninguno se confunde con conectado", () => {
    const otros: EstadoSesion[] = [
      { estado: "conectando" },
      { estado: "sin-vincular", qr: null, codigo: null },
      { estado: "desconectado", motivo: "token" },
      { estado: "cerrada", motivo: "logout" },
      { estado: "baneado", codigo: "spam", expira: "2026-09-01" },
    ];
    for (const e of otros) {
      assert.notStrictEqual(e.estado, "conectado", `${e.estado} no puede pasar por conectado`);
    }
  });
});

describe("saltar transitorio ≠ descartar", () => {
  it("los tres motivos que se reintentan son los que pasan solos", () => {
    assert.deepStrictEqual([...MOTIVOS_TRANSITORIOS].sort(), [
      "desconectado",
      "frenado",
      "tope_linea",
    ]);
  });

  it("🔴 `desconectado` es transitorio: el transporte vuelve y el lead sigue esperando", () => {
    assert.strictEqual(esTransitorio("desconectado"), true);
  });

  it("`tope_linea` es transitorio: el tope de la hora se reinicia solo", () => {
    assert.strictEqual(esTransitorio("tope_linea"), true);
  });

  it("lo definitivo NO se reintenta — contestar ahí sería hablar encima o insistir", () => {
    const definitivos: MotivoSalto[] = [
      "apagado",
      "linea_no_habilitada",
      "pausado",
      "vendedora_activa",
      "spam",
      "tope_turnos",
    ];
    for (const m of definitivos) {
      assert.strictEqual(esTransitorio(m), false, `${m} no se reintenta`);
    }
  });

  it("`vendedora_activa` es el que MÁS importa que no se reintente", () => {
    // Reintentarlo sería el bot esperando 90 s para volver a escribirle encima
    // a la vendedora que acaba de tomar la conversación.
    assert.strictEqual(esTransitorio("vendedora_activa"), false);
  });
});
