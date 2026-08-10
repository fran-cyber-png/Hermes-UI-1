import { describe, it } from "node:test";
import assert from "node:assert";
import { configuracionDeLink, estaVigente, puedeEditarPorLink } from "./linkModelo.js";

/**
 * EL MODELO DEL LINK (ADR 0048).
 *
 * 🔴 Lo que este archivo protege es UNA invariante: **editar exige sesión**.
 * Decisión del dueño del 10-ago, y el motivo por el que no se puede relajar con
 * un flag: sin identidad no hay autoría. Una página del equipo que un anónimo
 * puede reescribir no tiene a quién atribuirle el cambio — y si el link se
 * reenvía a un grupo, todo el grupo la edita.
 */

describe("configuracionDeLink — la invariante", () => {
  it("🔴 público + editar se RECHAZA, y no se degrada a «ver» en silencio", () => {
    // Degradar le daría a la vendedora un link que hace menos de lo que la
    // pantalla le dijo: la clase de sorpresa que después nadie puede explicar.
    const r = configuracionDeLink({ alcance: "publico", permiso: "editar" });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.motivo : "", /solo lectura/);
  });

  it("goberna + editar se acepta: hay sesión detrás, o sea autoría", () => {
    const r = configuracionDeLink({ alcance: "goberna", permiso: "editar" });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.config.permiso, "editar");
  });

  it("el default es lo más cerrado: público y de solo lectura", () => {
    // Un body sin nada tiene que producir el link menos poderoso posible, no el
    // más cómodo.
    const r = configuracionDeLink({});
    assert.equal(r.ok && r.config.alcance, "publico");
    assert.equal(r.ok && r.config.permiso, "ver");
    assert.equal(r.ok && r.config.venceAt, null);
  });

  it("un alcance o un permiso inventado se rechaza, no cae al default", () => {
    assert.equal(configuracionDeLink({ alcance: "todos" }).ok, false);
    assert.equal(configuracionDeLink({ alcance: "goberna", permiso: "borrar" }).ok, false);
  });
});

describe("configuracionDeLink — el vencimiento", () => {
  it("ausente o null = NO VENCE, que es el default", () => {
    // El link de un lead no puede morirse justo cuando vuelve a preguntar el
    // precio (ADR 0047 §6): vencer es una elección, no una política.
    const sinNada = configuracionDeLink({});
    assert.equal(sinNada.ok && sinNada.config.venceAt, null);
    const r = configuracionDeLink({ venceAt: null });
    assert.equal(r.ok && r.config.venceAt, null);
  });

  it("una fecha ISO se entiende", () => {
    const r = configuracionDeLink({ venceAt: "2026-09-01T00:00:00Z" });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.config.venceAt?.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("una fecha que no se entiende se RECHAZA, no se ignora", () => {
    // Ignorarla crearía un link eterno cuando la vendedora pidió uno que vence.
    assert.equal(configuracionDeLink({ venceAt: "el jueves" }).ok, false);
  });
});

describe("estaVigente", () => {
  const ahora = new Date("2026-08-10T12:00:00Z");

  it("sin vencimiento, siempre", () => {
    assert.equal(estaVigente({ venceAt: null }, ahora), true);
  });

  it("antes de la fecha, sí; después, no", () => {
    assert.equal(estaVigente({ venceAt: new Date("2026-08-11T00:00:00Z") }, ahora), true);
    assert.equal(estaVigente({ venceAt: new Date("2026-08-09T00:00:00Z") }, ahora), false);
  });

  it("justo en el instante del vencimiento ya NO sirve", () => {
    // El borde se fija a propósito: «vence a las 12» tiene que significar que a
    // las 12 en punto ya no abre.
    assert.equal(estaVigente({ venceAt: ahora }, ahora), false);
  });
});

describe("puedeEditarPorLink", () => {
  it("🔴 con permiso de editar pero SIN sesión, no edita", () => {
    assert.equal(puedeEditarPorLink({ alcance: "goberna", permiso: "editar" }, false), false);
  });

  it("con permiso y con sesión, sí", () => {
    assert.equal(puedeEditarPorLink({ alcance: "goberna", permiso: "editar" }, true), true);
  });

  it("un link público no edita ni con sesión", () => {
    // El alcance manda: si el link se repartió como público, que quien lo abra
    // tenga sesión no lo convierte en un link del equipo.
    assert.equal(puedeEditarPorLink({ alcance: "publico", permiso: "editar" }, true), false);
  });

  it("permiso «ver» no edita nunca", () => {
    assert.equal(puedeEditarPorLink({ alcance: "goberna", permiso: "ver" }, true), false);
  });
});
