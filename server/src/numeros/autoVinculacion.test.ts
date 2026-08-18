import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { puedeAutoVincular, transportePuedeVincular } from "./autoVinculacion.js";

const MI_NUMERO = "51955135507";
const OTRO_NUMERO = "51987654321";

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
      puedeAutoVincular("ana", { HERMES_SUPERVISORES: "ana" } as NodeJS.ProcessEnv, [OTRO_NUMERO], MI_NUMERO),
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
    assert.deepEqual(puedeAutoVincular("ana", WHATSMEOW_CON_ANA_SUPERVISORA, [OTRO_NUMERO], MI_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("quien ya tiene OTRA línea no puede traer una segunda — 'solo 1'", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [OTRO_NUMERO], MI_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("🔴 re-vincular LA PROPIA sí se puede: «solo 1» es cuántas, no cuántas veces", () => {
    // Es el reintento del montaje: si `agregarLineaWhatsmeow` falló, la fila ya
    // está escrita y ésta es la única forma de volver a levantarla desde la app.
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [MI_NUMERO], MI_NUMERO), { ok: true });
  });

  test("con una línea propia, pedir OTRA sigue siendo `ya_tiene_linea`", () => {
    assert.deepEqual(puedeAutoVincular("luz", WHATSMEOW, [MI_NUMERO], OTRO_NUMERO), {
      ok: false,
      motivo: "ya_tiene_linea",
    });
  });

  test("sin HERMES_SUPERVISORES configurado, nadie es supervisor (fail-closed heredado)", () => {
    assert.deepEqual(puedeAutoVincular("cualquiera", WHATSMEOW, [], MI_NUMERO), { ok: true });
  });
});
