import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarGestion, sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarNegocio } from "./negocio.js";

/**
 * EL PANEL DEL NEGOCIO — el embudo por CURSO y por ANUNCIO (#128), y las
 * métricas de atención (#126), derivados en consulta.
 *
 * Lo que estos tests fijan no es la aritmética (eso es trivial): es el
 * CABLEADO — que «llegaron» sea el primer entrante y no cualquiera, que la
 * demora salga de la primera respuesta POSTERIOR a ese entrante, que cotizado
 * venga de la etapa efectiva del ADR 0013 y no de una segunda definición, y que
 * lo que no se puede atribuir se diga en vez de repartirse.
 */

const AHORA = new Date("2026-07-25T18:00:00Z"); // 13:00 de Lima, jueves — en horario
const enLima = (dia: string, hora: string) => new Date(`${dia}T${hora}-05:00`);

/** El rango por defecto de los tests: los 7 días que terminan en AHORA. */
const RANGO = { desde: new Date("2026-07-19T05:00:00Z"), hasta: new Date("2026-07-26T05:00:00Z") };

const opciones = (extra: Record<string, unknown> = {}) => ({
  ...RANGO,
  ahora: AHORA,
  dimension: "curso" as const,
  ...extra,
});

/** La clave de conversación que arman la cola y el radar, para sembrar gestiones. */
const clave = (personaId: string, numeroPropio = "51999999999") =>
  `conv:whatsapp:${personaId}:${numeroPropio}`;

describe("consultarNegocio — atención (#126)", () => {
  test("«llegaron» es el PRIMER entrante: una conversación vieja que sigue hablando no vuelve a contar", async (t) => {
    const db = await baseDePrueba(t);
    // Nueva: primer entrante dentro del período.
    await sembrarMensaje(db, { personaId: "nueva", occurredAt: enLima("2026-07-22", "10:00") });
    // Vieja: empezó ANTES del período aunque escribió de nuevo adentro.
    await sembrarMensaje(db, { personaId: "vieja", occurredAt: enLima("2026-07-01", "10:00") });
    await sembrarMensaje(db, { personaId: "vieja", occurredAt: enLima("2026-07-23", "10:00") });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.conversaciones, 1);
  });

  test("esperan / jamás respondidas / respondidas: tres estados, sin solaparse mal", async (t) => {
    const db = await baseDePrueba(t);
    // (a) jamás respondida — nadie escribió nunca de vuelta.
    await sembrarMensaje(db, { personaId: "jamas", occurredAt: enLima("2026-07-22", "10:00") });
    // (b) respondida y cerrada: última palabra nuestra.
    await sembrarMensaje(db, { personaId: "atendida", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "atendida",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "10:20"),
    });
    // (c) respondida pero volvió a escribir: la última palabra es de ella.
    await sembrarMensaje(db, { personaId: "rebote", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "rebote",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "10:10"),
    });
    await sembrarMensaje(db, { personaId: "rebote", occurredAt: enLima("2026-07-22", "11:00") });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.conversaciones, 3);
    assert.equal(r.atencion.nunca_respondidos, 1, "solo «jamas» no recibió nunca una respuesta");
    assert.equal(r.atencion.esperan, 2, "«jamas» y «rebote» tienen la última palabra");
  });

  test("la demora es hasta la primera respuesta POSTERIOR al primer entrante", async (t) => {
    const db = await baseDePrueba(t);
    // Le habíamos escrito ANTES (prospección): ese saliente no es «la respuesta».
    await sembrarMensaje(db, {
      personaId: "p",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "09:00"),
    });
    await sembrarMensaje(db, { personaId: "p", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "p",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "10:30"),
    });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.demora_mediana_en_horario_min, 30);
  });

  test("las dos medianas se separan por horario — juntas serían un promedio que miente", async (t) => {
    const db = await baseDePrueba(t);
    // En horario: 10 minutos. Fuera (23:00): 9 horas hasta la mañana.
    await sembrarMensaje(db, { personaId: "dia", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "dia",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "10:10"),
    });
    await sembrarMensaje(db, { personaId: "noche", occurredAt: enLima("2026-07-22", "23:00") });
    await sembrarMensaje(db, {
      personaId: "noche",
      direccion: "saliente",
      occurredAt: enLima("2026-07-23", "08:00"),
    });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.demora_mediana_en_horario_min, 10);
    assert.equal(r.atencion.demora_mediana_fuera_min, 540);
    assert.equal(r.atencion.llegaron_fuera_de_horario, 1);
  });

  test("la cobertura horaria tiene SIEMPRE 24 puntos: el hueco es el dato", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p", occurredAt: enLima("2026-07-22", "23:30") });
    await sembrarMensaje(db, { personaId: "p", occurredAt: enLima("2026-07-22", "23:45") });
    await sembrarMensaje(db, {
      personaId: "p",
      direccion: "saliente",
      occurredAt: enLima("2026-07-23", "09:15"),
    });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.cobertura.length, 24);
    assert.deepEqual(
      r.atencion.cobertura.map((c) => c.hora),
      Array.from({ length: 24 }, (_, h) => h),
    );
    assert.deepEqual(r.atencion.cobertura[23], { hora: 23, entran: 2, salen: 0 });
    assert.deepEqual(r.atencion.cobertura[9], { hora: 9, entran: 0, salen: 1 });
    assert.deepEqual(r.atencion.cobertura[3], { hora: 3, entran: 0, salen: 0 });
  });

  test("sin atender hace más de 24 h: lo que ya dejó de ser un descuido", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "anteayer", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, { personaId: "recien", occurredAt: new Date(AHORA.getTime() - 3_600_000) });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.atencion.esperan, 2);
    assert.equal(r.atencion.sin_atender_24h, 1);
  });
});

describe("consultarNegocio — por curso (#128)", () => {
  test("el curso sale del lead que la persona llenó, cruzado por teléfono", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLead(db, { phone: "+51 987 654 321", campaignName: "Osint & Socmint" });
    await sembrarMensaje(db, { personaId: "51987654321", occurredAt: enLima("2026-07-22", "10:00") });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].clave, "Osint & Socmint");
    assert.equal(r.filas[0].llegaron, 1);
  });

  test("lo que no cruza con ningún formulario se DICE, no se reparte", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLead(db, { phone: "51987654321", campaignName: "Criminología" });
    await sembrarMensaje(db, { personaId: "51987654321", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, { personaId: "51900000001", occurredAt: enLima("2026-07-22", "11:00") });
    await sembrarMensaje(db, { personaId: "51900000002", occurredAt: enLima("2026-07-22", "12:00") });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.sin_atribuir, 2);
    assert.equal(r.atencion.conversaciones, 3);
    const conCurso = r.filas.filter((f) => f.clave !== null);
    assert.equal(conCurso.length, 1);
    assert.equal(conCurso[0].clave, "Criminología");
  });

  test("cotizados y cerrados salen de la etapa efectiva (ADR 0013), no de una segunda definición", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarLead(db, { phone: "51987654321", campaignName: "Ciberinteligencia" });
    await sembrarLead(db, { phone: "51987654322", campaignName: "Ciberinteligencia" });
    // (a) respondida sin gestión: la etapa efectiva la pone en «contactado».
    await sembrarMensaje(db, { personaId: "51987654321", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "51987654321",
      direccion: "saliente",
      occurredAt: enLima("2026-07-22", "10:10"),
    });
    // (b) con gestión «cotizado» asentada.
    await sembrarMensaje(db, { personaId: "51987654322", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarGestion(db, { clave: clave("51987654322"), etapa: "cotizado" });

    const r = await consultarNegocio(db, opciones());

    const fila = r.filas.find((f) => f.clave === "Ciberinteligencia");
    assert.ok(fila);
    assert.equal(fila.llegaron, 2);
    assert.equal(fila.cotizados, 1, "solo la que tiene la gestión asentada");
  });

  test("el subregistro de cotizaciones se muestra: precio mencionado vs cotizado asentado", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p1", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "p1",
      direccion: "saliente",
      texto: "La inversión es de S/ 450 en dos cuotas",
      occurredAt: enLima("2026-07-22", "10:10"),
    });
    await sembrarMensaje(db, { personaId: "p2", occurredAt: enLima("2026-07-22", "10:00") });
    await sembrarMensaje(db, {
      personaId: "p2",
      direccion: "saliente",
      texto: "hola, ya te paso los datos",
      occurredAt: enLima("2026-07-22", "10:10"),
    });

    const r = await consultarNegocio(db, opciones());

    assert.equal(r.subregistro.precio_mencionado, 1);
    assert.equal(r.subregistro.cotizados, 0);
  });
});

describe("consultarNegocio — por anuncio y por número (#128, #50)", () => {
  test("por anuncio agrupa por el título del origen del primer mensaje", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: "p1",
      origen: { fuente: "anuncio", titulo: "No lo dejes pasar", adId: "ad-1" },
      occurredAt: enLima("2026-07-22", "10:00"),
    });
    await sembrarMensaje(db, {
      personaId: "p2",
      origen: { fuente: "anuncio", titulo: "No lo dejes pasar", adId: "ad-1" },
      occurredAt: enLima("2026-07-22", "11:00"),
    });
    await sembrarMensaje(db, { personaId: "p3", occurredAt: enLima("2026-07-22", "12:00") });

    const r = await consultarNegocio(db, opciones({ dimension: "anuncio" }));

    const fila = r.filas.find((f) => f.clave === "No lo dejes pasar");
    assert.ok(fila);
    assert.equal(fila.llegaron, 2);
    assert.equal(fila.ad_id, "ad-1");
    assert.equal(r.sin_atribuir, 1, "la que llegó sin anuncio se cuenta aparte");
  });

  test("el filtro por número propio segmenta TODO, no solo la tabla", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: "p1",
      numeroPropio: "51111111111",
      occurredAt: enLima("2026-07-22", "10:00"),
    });
    await sembrarMensaje(db, {
      personaId: "p2",
      numeroPropio: "51222222222",
      occurredAt: enLima("2026-07-22", "11:00"),
    });

    const todos = await consultarNegocio(db, opciones());
    const uno = await consultarNegocio(db, opciones({ numeroPropio: "51111111111" }));

    assert.equal(todos.atencion.conversaciones, 2);
    assert.equal(uno.atencion.conversaciones, 1);
    assert.equal(
      uno.atencion.cobertura.reduce((n, c) => n + c.entran, 0),
      1,
      "la cobertura horaria también se filtra",
    );
    assert.deepEqual(todos.numeros.sort(), ["51111111111", "51222222222"]);
  });
});
