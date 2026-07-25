import test from "node:test";
import assert from "node:assert/strict";
import { HORA_APERTURA, HORA_CIERRE, enHorario, horasDelDia } from "./horarioAtencion.js";

/**
 * EL HORARIO DE ATENCIÓN — la línea que parte «10 minutos» de «8 horas».
 *
 * La medición de prod (#126) fue la que obligó a definirlo: la mediana de la
 * primera respuesta es 10 min EN horario y 496 min FUERA. Sin esta frontera
 * escrita en un solo lugar, las dos medianas son un promedio inútil de las dos.
 */

const enLima = (dia: string, hora: string) => new Date(`${dia}T${hora}-05:00`);

test("la frontera es la de Lima, no la del server en UTC", () => {
  // 13:00Z son las 08:00 de Lima: adentro. 12:59Z son las 07:59: afuera.
  assert.equal(enHorario(new Date("2026-07-25T13:00:00Z")), true);
  assert.equal(enHorario(new Date("2026-07-25T12:59:00Z")), false);
});

test("abre a las 8 y cierra a las 21 — los bordes, explícitos", () => {
  assert.equal(enHorario(enLima("2026-07-25", "07:59:59")), false);
  assert.equal(enHorario(enLima("2026-07-25", "08:00:00")), true);
  assert.equal(enHorario(enLima("2026-07-25", "20:59:59")), true);
  assert.equal(enHorario(enLima("2026-07-25", "21:00:00")), false);
});

test("la madrugada —donde entran 470 mensajes por semana y salen 15— es fuera de horario", () => {
  for (const hora of ["00:30", "03:00", "05:45", "07:00", "22:00", "23:30"]) {
    assert.equal(enHorario(enLima("2026-07-25", hora)), false, hora);
  }
});

test("las constantes describen el mismo horario que el predicado", () => {
  for (let h = 0; h < 24; h++) {
    const esperado = h >= HORA_APERTURA && h < HORA_CIERRE;
    assert.equal(enHorario(enLima("2026-07-25", `${String(h).padStart(2, "0")}:30`)), esperado, `${h}h`);
  }
});

test("horasDelDia son las 24 horas, en orden y sin huecos", () => {
  assert.equal(horasDelDia().length, 24);
  assert.deepEqual(horasDelDia().slice(0, 3), [0, 1, 2]);
  assert.equal(horasDelDia()[23], 23);
});
