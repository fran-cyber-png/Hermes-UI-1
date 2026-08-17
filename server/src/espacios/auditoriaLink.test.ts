import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENTOS_DE_LINK,
  etiquetaDeToken,
  filtrarEventos,
  HEX_QUE_NO_SE_PUBLICAN,
  LARGO_ETIQUETA,
  personasDelRegistro,
  resumirLink,
  resumirPorLink,
  type EventoAnotado,
  type EventoDeLink,
} from "./auditoriaLink.js";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function evento(parcial: Partial<EventoAnotado> & { evento: EventoDeLink }): EventoAnotado {
  return {
    id: 1,
    notaId: 7,
    etiqueta: "a1b2c3",
    quien: null,
    at: new Date("2026-08-15T10:00:00Z"),
    ...parcial,
  };
}

test("la etiqueta son 6 hex del token y deja 104 bits sin publicar", () => {
  assert.equal(etiquetaDeToken(TOKEN), "a1b2c3");
  assert.equal(etiquetaDeToken(TOKEN).length, LARGO_ETIQUETA);
  // 🔴 El número que hace segura la tabla: lo que NO se copia al registro.
  assert.equal(HEX_QUE_NO_SE_PUBLICAN, 26);
});

test("🔴 la etiqueta NO sirve para reconstruir el token", () => {
  // Es un apodo, no una credencial recortada: no se puede volver atrás.
  assert.ok(!TOKEN.startsWith(etiquetaDeToken(TOKEN) + TOKEN.slice(LARGO_ETIQUETA + 1)));
  assert.ok(etiquetaDeToken(TOKEN).length < TOKEN.length);
});

test("lo que no tiene forma de token no se etiqueta a medias", () => {
  // Un apodo inventado taparía que alguien está pasando otra cosa por acá.
  assert.equal(etiquetaDeToken("no-es-un-token"), "??????");
  assert.equal(etiquetaDeToken(""), "??????");
  assert.equal(etiquetaDeToken("A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6"), "??????", "hex en mayúsculas no lo produce nuevoToken");
});

test("🔴 aperturas, personas de Goberna y anónimas son TRES números distintos", () => {
  const r = resumirLink([
    evento({ evento: "creado", quien: "luz", at: new Date("2026-08-10T09:00:00Z") }),
    evento({ evento: "usado", quien: null }),
    evento({ evento: "usado", quien: null }),
    evento({ evento: "usado", quien: "alan" }),
    evento({ evento: "usado", quien: "Alan" }),
  ]);

  assert.equal(r.aperturas, 4, "se abrió cuatro veces, y eso es exacto");
  // Dos aperturas anónimas pueden ser una persona que recargó o dos personas: no
  // se sabe, y por eso NO se suman a «personas».
  assert.equal(r.anonimas, 2);
  // `alan` y `Alan` son la misma persona (ADR 0046): se compara normalizando.
  assert.equal(r.personasDeGoberna, 1);
  assert.equal(r.creadoPor, "luz");
});

test("la última apertura es la MÁS NUEVA, no la última fila", () => {
  const r = resumirLink([
    evento({ evento: "usado", at: new Date("2026-08-15T10:00:00Z") }),
    evento({ evento: "usado", at: new Date("2026-08-19T10:00:00Z") }),
    evento({ evento: "usado", at: new Date("2026-08-17T10:00:00Z") }),
  ]);
  assert.equal(r.ultimaApertura?.toISOString(), new Date("2026-08-19T10:00:00Z").toISOString());
});

test("nunca abierto: `ultimaApertura` es null, no una fecha de relleno", () => {
  const r = resumirLink([evento({ evento: "creado", quien: "luz" })]);
  assert.equal(r.ultimaApertura, null);
  assert.equal(r.aperturas, 0);
  assert.equal(r.cortadoAt, null, "sin corte, sigue vivo");
});

test("un link cortado conserva su historia — es cuando más importa", () => {
  const r = resumirLink([
    evento({ evento: "creado", quien: "luz", at: new Date("2026-08-10T09:00:00Z") }),
    evento({ evento: "usado", quien: null, at: new Date("2026-08-11T09:00:00Z") }),
    evento({ evento: "cortado", quien: "luz", at: new Date("2026-08-12T09:00:00Z") }),
  ]);
  assert.equal(r.aperturas, 1);
  assert.equal(r.cortadoAt?.toISOString(), new Date("2026-08-12T09:00:00Z").toISOString());
});

test("🔴 dos links de la MISMA página no suman sus usos", () => {
  // Se comparte, se corta, se vuelve a compartir: son dos puertas distintas, y
  // sumarlas daría «3 aperturas» sobre un link que se abrió una vez.
  const links = resumirPorLink([
    evento({ etiqueta: "aaaaaa", evento: "creado", quien: "luz", at: new Date("2026-08-10T09:00:00Z") }),
    evento({ etiqueta: "aaaaaa", evento: "usado", at: new Date("2026-08-10T10:00:00Z") }),
    evento({ etiqueta: "aaaaaa", evento: "usado", at: new Date("2026-08-10T11:00:00Z") }),
    evento({ etiqueta: "aaaaaa", evento: "cortado", quien: "luz", at: new Date("2026-08-11T09:00:00Z") }),
    evento({ etiqueta: "bbbbbb", evento: "creado", quien: "alan", at: new Date("2026-08-12T09:00:00Z") }),
    evento({ etiqueta: "bbbbbb", evento: "usado", at: new Date("2026-08-12T10:00:00Z") }),
  ]);

  assert.equal(links.length, 2);
  // El más nuevo primero.
  assert.equal(links[0].etiqueta, "bbbbbb");
  assert.equal(links[0].aperturas, 1);
  assert.equal(links[0].cortadoAt, null, "el de hoy sigue vivo");
  assert.equal(links[1].etiqueta, "aaaaaa");
  assert.equal(links[1].aperturas, 2);
  assert.ok(links[1].cortadoAt, "el viejo está cortado");
});

test("las reconfiguraciones se cuentan aparte de la creación", () => {
  const r = resumirLink([
    evento({ evento: "creado", quien: "luz", alcance: "publico", permiso: "ver" }),
    evento({ evento: "reconfigurado", quien: "luz", alcance: "goberna", permiso: "editar" }),
    evento({ evento: "reconfigurado", quien: "alan", alcance: "goberna", permiso: "ver" }),
  ]);
  assert.equal(r.reconfiguraciones, 2);
  assert.equal(r.creadoPor, "luz", "reconfigurar no reescribe quién lo abrió");
});

test("el filtro por persona ofrece SOLO a quien hizo algo, sin repetir grafías", () => {
  const personas = personasDelRegistro([
    evento({ evento: "creado", quien: "Luz" }),
    evento({ evento: "usado", quien: "luz" }),
    evento({ evento: "usado", quien: null }),
    evento({ evento: "cortado", quien: "alan" }),
  ]);
  // `Luz`/`luz` es UNA opción (si no, el desplegable ofrece dos filtros para la
  // misma persona y cada uno devuelve la mitad de sus eventos).
  assert.deepEqual(personas, ["alan", "Luz"]);
});

test("filtrar sin criterios devuelve todo — es el estado inicial", () => {
  const todos = [evento({ evento: "creado", quien: "luz" }), evento({ evento: "usado", quien: null })];
  assert.equal(filtrarEventos(todos, {}).length, 2);
});

test("el filtro por persona normaliza los dos lados", () => {
  const todos = [
    evento({ id: 1, evento: "creado", quien: "Luz" }),
    evento({ id: 2, evento: "usado", quien: null }),
    evento({ id: 3, evento: "cortado", quien: "alan" }),
  ];
  // Con comparación exacta, filtrar por `luz` no devolvería nada y se leería como
  // que no hizo nada — el defecto de #386, otra vez.
  assert.deepEqual(filtrarEventos(todos, { quien: "luz" }).map((e) => e.id), [1]);
});

test("una apertura anónima NUNCA cae bajo el filtro de una persona", () => {
  const todos = [evento({ id: 2, evento: "usado", quien: null })];
  assert.equal(filtrarEventos(todos, { quien: "luz" }).length, 0);
});

test("los dos filtros se combinan con Y", () => {
  const todos = [
    evento({ id: 1, evento: "creado", quien: "luz" }),
    evento({ id: 2, evento: "usado", quien: "luz" }),
    evento({ id: 3, evento: "usado", quien: "alan" }),
  ];
  assert.deepEqual(filtrarEventos(todos, { quien: "luz", evento: "usado" }).map((e) => e.id), [2]);
});

test("el vocabulario es cerrado y estos cuatro son los que la pantalla sabe leer", () => {
  assert.deepEqual([...EVENTOS_DE_LINK], ["creado", "reconfigurado", "usado", "cortado"]);
});
