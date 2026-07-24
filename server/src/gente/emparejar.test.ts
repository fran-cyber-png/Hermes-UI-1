import { test } from "node:test";
import assert from "node:assert/strict";
import { emparejarLeads, elegirMejorLead, fuenteDeLead, type FilaLead } from "./emparejar.js";

/**
 * EL EMPAREJAMIENTO LEAD ↔ TELÉFONO, en puro.
 *
 * La consulta (SQL, en `leadDeTelefono`) sólo trae filas; QUIÉN gana cuando un
 * teléfono matchea varios leads, y CÓMO se deriva la procedencia, se decide acá
 * — donde se puede testear sin base. Un teléfono puede matchear más de un lead:
 * la misma persona llenó dos formularios, o el mismo número entró por Meta y por
 * una landing web (ICARUS). La regla no puede ser «el primero que devuelve
 * Postgres»: es «el más completo, y ante empate el más nuevo».
 */

function fila(p: Partial<FilaLead> & { sufijo: string }): FilaLead {
  return {
    fullName: null,
    email: null,
    campaignName: null,
    adName: null,
    formName: null,
    platform: null,
    createdTime: "2026-04-01T00:00:00.000Z",
    ...p,
  };
}

test("fuenteDeLead: web si es de ICARUS/landing, meta si no", () => {
  assert.equal(fuenteDeLead(fila({ sufijo: "1", platform: "fb" })), "meta");
  assert.equal(fuenteDeLead(fila({ sufijo: "1", platform: "ig" })), "meta");
  assert.equal(fuenteDeLead(fila({ sufijo: "1", platform: "web" })), "web");
  assert.equal(fuenteDeLead(fila({ sufijo: "1", formName: "icarus:landing" })), "web");
  // Sin señales explícitas, el default histórico es Meta (los 680 leads son de ahí).
  assert.equal(fuenteDeLead(fila({ sufijo: "1", platform: null, formName: null })), "meta");
});

test("elegirMejorLead: prefiere el que tiene email; ante empate, el más nuevo", () => {
  const sinEmailNuevo = fila({ sufijo: "9", email: null, createdTime: "2026-05-10T00:00:00Z" });
  const conEmailViejo = fila({ sufijo: "9", email: "a@b.com", createdTime: "2026-04-01T00:00:00Z" });
  // Gana el que tiene email aunque sea más viejo: el email es el insumo que falta.
  assert.equal(elegirMejorLead([sinEmailNuevo, conEmailViejo]).email, "a@b.com");

  const conEmailViejo2 = fila({ sufijo: "9", email: "viejo@b.com", createdTime: "2026-04-01T00:00:00Z" });
  const conEmailNuevo = fila({ sufijo: "9", email: "nuevo@b.com", createdTime: "2026-05-20T00:00:00Z" });
  // Los dos tienen email → desempata la fecha (el más nuevo).
  assert.equal(elegirMejorLead([conEmailViejo2, conEmailNuevo]).email, "nuevo@b.com");

  const viejo = fila({ sufijo: "9", email: null, createdTime: "2026-04-01T00:00:00Z" });
  const nuevo = fila({ sufijo: "9", email: null, createdTime: "2026-05-01T00:00:00Z" });
  // Ninguno tiene email → el más nuevo.
  assert.equal(elegirMejorLead([viejo, nuevo]).createdTime, "2026-05-01T00:00:00Z");
});

test("emparejarLeads: matchea por sufijo de 9 dígitos aunque el formato difiera", () => {
  const filas: FilaLead[] = [
    fila({ sufijo: "987654321", email: "lead@goberna.com", fullName: "Ana Real", campaignName: "[ABR] OSINT" }),
  ];
  // El teléfono de la conversación llega con prefijo/espacios; el lead se guardó pelado.
  const mapa = emparejarLeads(["+51 987 654 321"], filas);
  assert.equal(mapa["+51 987 654 321"]?.email, "lead@goberna.com");
  assert.equal(mapa["+51 987 654 321"]?.nombre, "Ana Real");
  assert.equal(mapa["+51 987 654 321"]?.campana, "[ABR] OSINT");
  assert.equal(mapa["+51 987 654 321"]?.fuente, "meta");
});

test("emparejarLeads: un teléfono sin lead no aparece en el mapa (no inventa null)", () => {
  const mapa = emparejarLeads(["51999999999"], [fila({ sufijo: "987654321" })]);
  assert.equal(mapa["51999999999"], undefined);
});

test("emparejarLeads: con varios leads del mismo teléfono, aplica la regla del mejor", () => {
  const filas: FilaLead[] = [
    fila({ sufijo: "987654321", email: null, platform: "web", createdTime: "2026-06-01T00:00:00Z" }),
    fila({ sufijo: "987654321", email: "elegido@goberna.com", platform: "fb", createdTime: "2026-04-01T00:00:00Z" }),
  ];
  const mapa = emparejarLeads(["987654321"], filas);
  // Gana el que tiene email (el de Meta), y su procedencia viaja con él.
  assert.equal(mapa["987654321"]?.email, "elegido@goberna.com");
  assert.equal(mapa["987654321"]?.fuente, "meta");
});
