import assert from "node:assert/strict";
import test from "node:test";
import {
  fueRetenido,
  leerCalidad,
  leerEstado,
  leerRechazo,
  sePuedeMandar,
  type PlantillaDeMeta,
} from "./estadoDePlantilla.js";

test("solo APPROVED se puede mandar", () => {
  assert.equal(sePuedeMandar({ status: "APPROVED" }), true);
  for (const s of ["PENDING", "REJECTED", "PAUSED", "DISABLED", "IN_APPEAL", "LIMIT_EXCEEDED"]) {
    assert.equal(sePuedeMandar({ status: s }), false, `${s} no puede mandar`);
  }
});

test("UN ESTADO QUE META INVENTE MAÑANA NO SE PUEDE MANDAR (lista blanca, no negra)", () => {
  // Con lista negra, un PAUSED_V2 pasaria el filtro y mandaria hasta que un
  // humano lo notara. El costo de equivocarse para este lado es una campana que
  // no sale; para el otro, un 132015 por cada destinatario.
  assert.equal(sePuedeMandar({ status: "PAUSED_V2" }), false);
  const l = leerEstado({ status: "PAUSED_V2" });
  assert.equal(l.enviable, false);
  assert.equal(l.tono, "problema");
  assert.match(l.detalle!, /PAUSED_V2/, "dice el valor crudo para poder buscarlo");
});

test("IN_REVIEW no existe en la API aunque el Business Manager lo muestre", () => {
  // Si alguien escribe la rama, cae en desconocido y NO se manda — que es lo
  // correcto: el estado real de una en revision es PENDING.
  const l = leerEstado({ status: "IN_REVIEW" });
  assert.equal(l.enviable, false);
  assert.equal(leerEstado({ status: "PENDING" }).titulo, "En revisión");
});

test("sin status tampoco se manda", () => {
  assert.equal(sePuedeMandar({}), false);
  assert.equal(leerEstado({}).enviable, false);
});

test("los estados raros que casi nadie contempla tienen lectura propia", () => {
  assert.equal(leerEstado({ status: "LIMIT_EXCEEDED" }).titulo, "Fuera de cupo");
  assert.equal(leerEstado({ status: "PENDING_DELETION" }).titulo, "Borrada");
  assert.equal(leerEstado({ status: "ARCHIVED" }).titulo, "Archivada");
  assert.equal(leerEstado({ status: "IN_APPEAL" }).tono, "espera");
});

test("PAUSED explica que se despausa sola y que a la tercera muere", () => {
  const l = leerEstado({ status: "PAUSED" });
  assert.equal(l.tono, "problema");
  assert.match(l.detalle!, /3 h/);
  assert.match(l.detalle!, /deshabilitada/);
});

test("un rechazo sin motivo NO se presenta como «sin problema»", () => {
  // Meta manda el enum pelado casi siempre; solo explica INVALID_FORMAT y solo
  // por webhook. Decirlo evita que la pantalla parezca rota.
  const l = leerEstado({ status: "REJECTED", rejected_reason: "NONE" });
  assert.equal(l.tono, "problema");
  assert.match(l.detalle!, /Business Support Home/);
});

test("los seis motivos de rechazo tienen lectura, y uno nuevo no rompe", () => {
  for (const m of ["ABUSIVE_CONTENT", "INVALID_FORMAT", "PROMOTIONAL", "TAG_CONTENT_MISMATCH", "SCAM"]) {
    const t = leerRechazo(m);
    assert.ok(t.length > 10, `${m} tiene lectura`);
    assert.ok(!t.includes(m), `${m} no se muestra crudo cuando lo conocemos`);
  }
  // INCORRECT_CATEGORY solo existe en el enum del WEBHOOK, no en el del nodo —
  // se lee igual, porque el mismo lector sirve para los dos.
  assert.match(leerRechazo("INCORRECT_CATEGORY"), /categoría/);
  assert.match(leerRechazo("ALGO_NUEVO"), /ALGO_NUEVO/, "uno nuevo se muestra crudo, no se traga");
});

test("UNKNOWN es «todavía no hay datos», NUNCA «está bien»", () => {
  // Mismo criterio que edad_del_dato: null en Ivi — el silencio no puede leerse
  // como buena noticia. Y es el estado en el que Meta aplica pacing.
  const sinMedir = leerCalidad({ quality_score: { score: "UNKNOWN" } });
  assert.equal(sinMedir.tono, "espera");
  assert.notEqual(sinMedir.tono, "bien");
  assert.deepEqual(leerCalidad({}), sinMedir, "sin el campo, lo mismo");
  assert.deepEqual(leerCalidad({ quality_score: null }), sinMedir);
});

test("la calidad distingue los tres colores", () => {
  assert.equal(leerCalidad({ quality_score: { score: "GREEN" } }).tono, "bien");
  assert.equal(leerCalidad({ quality_score: { score: "YELLOW" } }).tono, "espera");
  assert.equal(leerCalidad({ quality_score: { score: "RED" } }).tono, "problema");
});

test("un color nuevo cae en «sin medir», no en «bien»", () => {
  const l = leerCalidad({ quality_score: { score: "BLUE" } });
  assert.equal(l.tono, "espera");
  assert.match(l.texto, /BLUE/);
});

test("UN 200 DE META NO GARANTIZA QUE EL MENSAJE SALGA", () => {
  // held_for_quality_assessment = pacing: Meta lo retiene para juntar feedback,
  // y si las senales son malas los siguientes se DESCARTAN.
  assert.equal(fueRetenido({ messages: [{ id: "wamid.X", message_status: "accepted" }] }), false);
  assert.equal(
    fueRetenido({ messages: [{ id: "wamid.X", message_status: "held_for_quality_assessment" }] }),
    true,
  );
});

test("fueRetenido no explota con formas inesperadas", () => {
  // Un campo accesorio no puede convertir un envio bueno en un error.
  for (const raro of [null, undefined, {}, { messages: null }, { messages: "x" }, 42, "hola"]) {
    assert.equal(fueRetenido(raro), false);
  }
});

test("la plantilla real de produccion se lee bien", () => {
  // Copia literal de lo que devolvio Meta el 5-ago-2026 para la linea del bot.
  const real: PlantillaDeMeta = {
    name: "promo_3x1_cursos",
    language: "en",
    status: "APPROVED",
    category: "MARKETING",
    quality_score: { score: "UNKNOWN" },
    rejected_reason: "NONE",
  };
  assert.equal(sePuedeMandar(real), true);
  assert.equal(leerEstado(real).titulo, "Aprobada");
  assert.equal(leerCalidad(real).tono, "espera", "UNKNOWN no es verde");
});
