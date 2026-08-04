import { test } from "node:test";
import assert from "node:assert/strict";
import { esActorDeSistema, separarEquipo, ACTORES_DE_SISTEMA } from "./equipo.js";
import type { FilaPorVendedora } from "./porVendedora.js";

function fila(vendedora: string, msjHoy = 0, msj7d = 0): FilaPorVendedora {
  return {
    vendedora,
    conversaciones_hoy: 0,
    mensajes_hoy: msjHoy,
    ventas_hoy: 0,
    conversaciones_7d: 0,
    mensajes_7d: msj7d,
    ventas_7d: 0,
  };
}

/**
 * LOS DOS QUE ESTABAN EN PRODUCCIÓN. Con sus cifras reales del 4-ago-2026, para
 * que el test diga de dónde salió el defecto y no solo qué hace la función.
 */
test("`bot` y `goberna-admin` no son personas; `alan` y `Usuario1` sí", () => {
  assert.equal(esActorDeSistema("bot"), true);
  assert.equal(esActorDeSistema("goberna-admin"), true);
  assert.equal(esActorDeSistema("alan"), false);
  assert.equal(esActorDeSistema("Usuario1"), false);
  assert.equal(esActorDeSistema("ventas10@grupogoberna.com"), false);
});

/** Misma razón que en `cola/asignadaSql.ts`: en prod las grafías conviven. */
test("compara normalizado de los dos lados", () => {
  assert.equal(esActorDeSistema("BOT"), true);
  assert.equal(esActorDeSistema("  Bot  "), true);
  assert.equal(esActorDeSistema("Goberna-Admin"), true);
  assert.equal(esActorDeSistema(""), false);
  assert.equal(esActorDeSistema("   "), false);
});

/**
 * 🔴 LA PROPIEDAD QUE ELIGE ESTE DISEÑO POR SOBRE UN PADRÓN DE PERSONAS.
 *
 * Un id que nadie enumeró es una PERSONA. Se puede colar un actor automático
 * nuevo (se arregla agregándolo a `ACTORES_DE_SISTEMA`), pero una vendedora
 * real no puede desaparecer del cuadro sola — que es el fallo que un padrón
 * basado en `sesiones_cerberus` habría tenido a los 14 días, en silencio.
 */
test("un id desconocido se asume PERSONA, nunca sistema", () => {
  assert.equal(esActorDeSistema("vendedora-que-entra-manana"), false);
  assert.equal(esActorDeSistema("ventas15@grupogoberna.com"), false);
  const { equipo } = separarEquipo([fila("nadie-la-enumero", 5, 9)]);
  assert.deepEqual(equipo.map((f) => f.vendedora), ["nadie-la-enumero"]);
});

test("separa las filas de prod: quedan las personas, se aparta lo automático", () => {
  const { equipo, automaticos } = separarEquipo([
    fila("goberna-admin", 10, 325),
    fila("bot", 4, 212),
    fila("Usuario1", 0, 78),
    fila("alan", 3, 3),
  ]);

  assert.deepEqual(equipo.map((f) => f.vendedora), ["Usuario1", "alan"], "el orden del SQL se respeta");
  assert.equal(automaticos?.mensajes_hoy, 14);
  assert.equal(automaticos?.mensajes_7d, 537);
  assert.deepEqual(automaticos?.quienes, ["bot", "goberna-admin"]);
});

/**
 * LO AUTOMÁTICO NO SE DESCARTA. Si se borrara, el cuadro diría «el equipo mandó
 * 81 mensajes» cuando salieron 618, y esa resta invisible es peor que el ruido:
 * el mismo argumento por el que `comoVaElReparto` trae a las inactivas.
 */
test("los mensajes automáticos sobreviven al filtro (no se restan del mundo)", () => {
  const filas = [fila("goberna-admin", 10, 325), fila("bot", 4, 212), fila("alan", 3, 81)];
  const { equipo, automaticos } = separarEquipo(filas);
  const total7d = filas.reduce((n, f) => n + f.mensajes_7d, 0);
  const contado = equipo.reduce((n, f) => n + f.mensajes_7d, 0) + (automaticos?.mensajes_7d ?? 0);
  assert.equal(contado, total7d, "nada se pierde entre las dos mitades");
});

/** Sin actores automáticos no hay renglón: `null`, no un cero que ocupa lugar. */
test("sin nada automático el renglón no existe", () => {
  const { equipo, automaticos } = separarEquipo([fila("alan", 3, 3), fila("luz", 1, 8)]);
  assert.equal(equipo.length, 2);
  assert.equal(automaticos, null);
});

/**
 * El bot con cero mensajes en las dos ventanas tampoco dibuja: mismo criterio
 * que los chips del bot en la cola, que solo existen con conteo > 0.
 */
test("un actor de sistema sin actividad no dibuja el renglón", () => {
  const { equipo, automaticos } = separarEquipo([fila("bot", 0, 0), fila("alan", 3, 3)]);
  assert.deepEqual(equipo.map((f) => f.vendedora), ["alan"]);
  assert.equal(automaticos, null);
});

/** El id del bot se importa de `bot/frenos.ts`: una sola definición del string. */
test("el id del bot no se re-declara acá", () => {
  assert.ok(ACTORES_DE_SISTEMA.includes("bot"));
  assert.equal(ACTORES_DE_SISTEMA.length, 2);
});
