import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { puedeAutoVincular, transportePuedeVincular } from "./autoVinculacion.js";

const MI_NUMERO = "51955135507";
const OTRO_NUMERO = "51987654321";

/** Una línea que NO comparte con nadie: la que sí ocupa el cupo de «solo 1». */
const propia = (numero: string) => ({ numero, duenas: 1 });
/** La línea del EQUIPO — `51984429504` tiene siete en producción. */
const compartida = (numero: string, duenas = 7) => ({ numero, duenas });

/** El server que SÍ puede vincular: whatsmeow. Sin supervisores configurados. */
const WHATSMEOW = { WHATSAPP_TRANSPORTE: "whatsmeow" } as NodeJS.ProcessEnv;
const WHATSMEOW_CON_ANA_SUPERVISORA = {
  WHATSAPP_TRANSPORTE: "whatsmeow",
  HERMES_SUPERVISORES: "ana",
} as NodeJS.ProcessEnv;

describe("transportePuedeVincular — el veto del server", () => {
  test("whatsmeow sí", () => {
    assert.equal(transportePuedeVincular(WHATSMEOW), true);
  });

  test("🔴 sin la variable, NO — el mismo default que arrancarWhatsapp (`falso`)", () => {
    assert.equal(transportePuedeVincular({} as NodeJS.ProcessEnv), false);
  });

  test("`falso` y `cloud-api` no vinculan: su sesión .db no la usaría nadie", () => {
    assert.equal(transportePuedeVincular({ WHATSAPP_TRANSPORTE: "falso" } as NodeJS.ProcessEnv), false);
    assert.equal(transportePuedeVincular({ WHATSAPP_TRANSPORTE: "cloud-api" } as NodeJS.ProcessEnv), false);
  });
});

describe("puedeAutoVincular", () => {
  test("una vendedora sin línea y sin ser supervisora, puede", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [], MI_NUMERO), { ok: true });
  });

  test("🔴 el transporte se pregunta PRIMERO: un botón no escribe una credencial que nadie va a usar", () => {
    // Producción corre `WHATSAPP_TRANSPORTE=falso`: acá es donde eso se convierte
    // en 409 en vez de en 43 MB de sesión de WhatsApp escritos en VPS1.
    assert.deepEqual(puedeAutoVincular("luz", {} as NodeJS.ProcessEnv, [], MI_NUMERO), {
      ok: false,
      motivo: "transporte_sin_vinculacion",
    });
  });

  test("el veto del transporte le gana hasta a una supervisora con línea", () => {
    assert.deepEqual(
      puedeAutoVincular("ana", { HERMES_SUPERVISORES: "ana" } as NodeJS.ProcessEnv, [propia(OTRO_NUMERO)], MI_NUMERO),
      { ok: false, motivo: "transporte_sin_vinculacion" },
    );
  });

  test("🔴 una supervisora SÍ puede — el veto por rol se retiró el 18-ago-2026", () => {
    // Antes esto devolvía `es_supervisor`. Es el test que cambia de signo con la
    // enmienda del dueño; se conserva en vez de borrarse porque lo que hay que
    // fijar no es «no hay regla», es **qué regla hay ahora**.
    assert.deepEqual(puedeAutoVincular("ana", WHATSMEOW_CON_ANA_SUPERVISORA, [], MI_NUMERO), { ok: true });
  });

  test("🔴 y estar en `HERMES_SUPERVISORES` con CUALQUIER grafía tampoco la frena", () => {
    // El caso que antes probaba la normalización del veto: `Ana` en la lista y
    // `ANA` en el token. Ya no hay nada que normalizar acá, y esto lo fija —
    // si alguien reintroduce el veto, este test se pone rojo antes que nadie.
    assert.deepEqual(puedeAutoVincular("ANA", WHATSMEOW_CON_ANA_SUPERVISORA, [], MI_NUMERO), { ok: true });
  });

  test("el tope de UNA línea NO se retiró: le sigue valiendo a la supervisora", () => {
    // Lo que se sacó es el veto por ROL, no el de CANTIDAD. Sin este test, un
    // «ahora pueden todos» se lee como «ahora pueden todo».
    assert.deepEqual(puedeAutoVincular("ana", WHATSMEOW_CON_ANA_SUPERVISORA, [propia(OTRO_NUMERO)], MI_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("quien ya tiene OTRA línea no puede traer una segunda — 'solo 1'", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [propia(OTRO_NUMERO)], MI_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("🔴 re-vincular LA PROPIA sí se puede: «solo 1» es cuántas, no cuántas veces", () => {
    // Es el reintento del montaje: si `agregarLineaWhatsmeow` falló, la fila ya
    // está escrita y ésta es la única forma de volver a levantarla desde la app.
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [propia(MI_NUMERO)], MI_NUMERO), { ok: true });
  });

  test("con una línea propia, pedir OTRA sigue siendo `ya_tiene_linea`", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [propia(MI_NUMERO)], OTRO_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("sin HERMES_SUPERVISORES configurado, nadie es supervisor (fail-closed heredado)", () => {
    assert.deepEqual(puedeAutoVincular("cualquiera", WHATSMEOW, [], MI_NUMERO), { ok: true });
  });
});

/**
 * 🔴 LA LÍNEA COMPARTIDA NO OCUPA EL CUPO (decisión del dueño, 17-ago-2026).
 *
 * El caso que lo motivó, medido en producción: `51984429504` («Ventas Meta», la
 * Cloud API que trae TODOS los leads) tiene **siete** personas asignadas — Luz,
 * Sindy y las cinco `ventas1X@`. Con el tope contando cualquier línea, las siete
 * caían en `ya_tiene_linea` y el panel les escondía el botón: el frente entero
 * era inalcanzable **justo para el equipo que vende**.
 *
 * Y era MUDO: el front sólo ofrece «Vincular tu WhatsApp» a quien no tiene
 * ninguna, así que no veían un rechazo — no veían nada.
 */
describe("puedeAutoVincular · la línea del equipo no cuenta", () => {
  test("🔴 con SOLO la compartida, puede traer la suya", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [compartida(OTRO_NUMERO)], MI_NUMERO), {
      ok: true,
    });
  });

  test("la compartida no la salva de tener YA una propia", () => {
    // Las dos juntas: la del equipo se ignora, la propia sigue ocupando el cupo.
    assert.deepEqual(
      puedeAutoVincular("luz", WHATSMEOW, [compartida(OTRO_NUMERO), propia("51900000001")], MI_NUMERO),
      { ok: false, motivo: "ya_tiene_linea" },
    );
  });

  test("dos dueñas ya es compartida — el corte es en 1, no en «muchas»", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [{ numero: OTRO_NUMERO, duenas: 2 }], MI_NUMERO), {
      ok: true,
    });
  });

  test("⚠️ y una SUPERVISORA con la del equipo también puede — las dos reglas se cruzan acá", () => {
    // Este test cambió de signo al mergear con la enmienda del 18-ago-2026: antes
    // afirmaba `es_supervisor` (el veto por rol le ganaba al cupo). Retirado ese
    // veto, lo que queda es sólo el cupo, y la línea del equipo no lo ocupa — o
    // sea que la persona a la que este frente y el otro le negaban el botón por
    // motivos distintos, ahora lo tiene por los dos.
    assert.deepEqual(
      puedeAutoVincular("ana", WHATSMEOW_CON_ANA_SUPERVISORA, [compartida(OTRO_NUMERO)], MI_NUMERO),
      { ok: true },
    );
  });
});
