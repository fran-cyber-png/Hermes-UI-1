import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { campanaAnuncio, campanaRuteo } from "../db/routing.js";
import { asignarSiHaceFalta } from "../reparto/asignar.js";
import { duenoPorCampana, fotoDeRouting, ponerRegla, sacarRegla } from "./repositorio.js";

/**
 * EL RUTEO POR CAMPAÑA, contra una Postgres de verdad.
 *
 * Lo que ningún test puro puede ver: que la regla le GANE a la rueda en el mismo
 * camino que corre el webhook, que sacar la regla devuelva la campaña a la rueda
 * y que sin las tablas migradas esto **degrade en vez de tumbar la ingesta**.
 */

const LINEA = "51984429504";
const AD_OSINT = "120249343592840789";
const AD_OSINT_2 = "120249343886580789";
const AD_INTELIGENCIA = "120248613186150016";
const CAMP_OSINT = "120249343592830789";
const CAMP_INTELIGENCIA = "120248613186140016";

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

async function sembrarRueda(db: Db) {
  await db.insert(repartoRueda).values(
    ["ana", "beto", "caro"].map((vendedoraId, orden) => ({ numeroPropio: LINEA, vendedoraId, orden })),
  );
}

/** Los anuncios como los deja `POST /api/routing/refrescar`. */
async function sembrarAnuncios(db: Db) {
  await db.insert(campanaAnuncio).values([
    { adId: AD_OSINT, campanaId: CAMP_OSINT, campanaNombre: "[AGO] OSINT", estado: "ACTIVE" },
    { adId: AD_OSINT_2, campanaId: CAMP_OSINT, campanaNombre: "[AGO] OSINT", estado: "ACTIVE" },
    {
      adId: AD_INTELIGENCIA,
      campanaId: CAMP_INTELIGENCIA,
      campanaNombre: "[JUL] INTELIGENCIA | WSP",
      estado: "PAUSED",
    },
  ]);
}

/** Un click-to-WhatsApp como lo escribe `webhook/whatsapp.ts`. */
async function sembrarLlegada(db: Db, adId: string, telefono: string, cuando = new Date()) {
  await db.execute(`
    INSERT INTO events (source, external_id, occurred_at, payload)
    VALUES ('meta_wa_ctwa', 'wamid-${telefono}-${adId}', '${cuando.toISOString()}',
            '{"from":"${telefono}","referral":{"source_id":"${adId}"}}'::jsonb)
  `);
}

// ── Lo que hace el webhook ───────────────────────────────────────────────────

test("🔴 la regla de campaña le gana a la rueda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  // `ana` es la primera de la rueda y con round-robin le tocaría a ella.
  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000001:${LINEA}`, LINEA, AD_OSINT);

  assert.equal(quien, "caro");
  const [fila] = await db
    .select({ motivo: conversacionAsignada.motivo })
    .from(conversacionAsignada)
    .where(eq(conversacionAsignada.clave, `conv:whatsapp:51900000001:${LINEA}`));
  assert.equal(fila?.motivo, "campana", "el motivo distingue una regla de un turno de rueda");
});

test("otro anuncio de la MISMA campaña cae en la misma persona", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  // Es el punto de rutear por campaña y no por anuncio: los cuatro anuncios de
  // la campaña de agosto son una sola decisión.
  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000002:${LINEA}`, LINEA, AD_OSINT_2);
  assert.equal(quien, "caro");
});

test("una campaña SIN regla se reparte por la rueda, como siempre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  const quien = await asignarSiHaceFalta(
    db,
    `conv:whatsapp:51900000003:${LINEA}`,
    LINEA,
    AD_INTELIGENCIA,
  );
  assert.equal(quien, "ana", "la primera de la rueda");
});

/**
 * 🔴 LOS TRES CAMINOS QUE VUELVEN A LA RUEDA, y ninguno es un error. El del
 * medio es el que muerde: un anuncio ESTRENADO HOY existe en Meta y todavía no
 * en `campana_anuncio`, así que su campaña puede tener regla y el lead cae igual
 * en la rueda hasta que alguien apriete «Actualizar desde Meta».
 */
test("sin anuncio, con anuncio no resuelto o con campaña sin regla: manda la rueda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  assert.equal(await duenoPorCampana(db, LINEA, null), null, "sin anuncio");
  assert.equal(await duenoPorCampana(db, LINEA, "  "), null, "un anuncio en blanco");
  assert.equal(await duenoPorCampana(db, LINEA, "9999-estrenado-hoy"), null, "sin resolver");
  assert.equal(await duenoPorCampana(db, LINEA, AD_INTELIGENCIA), null, "campaña sin regla");
  assert.equal(await duenoPorCampana(db, "51986394450", AD_OSINT), null, "la regla es POR LÍNEA");
});

test("la regla NO reasigna lo ya repartido", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  const clave = `conv:whatsapp:51900000004:${LINEA}`;

  const primero = await asignarSiHaceFalta(db, clave, LINEA, AD_OSINT);
  assert.equal(primero, "ana", "sin regla todavía: rueda");

  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");
  const segundo = await asignarSiHaceFalta(db, clave, LINEA, AD_OSINT);

  assert.equal(segundo, "ana", "una conversación no cambia de manos a mitad de la charla");
});

test("sacar la regla devuelve la campaña a la rueda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  assert.equal(await sacarRegla(db, LINEA, CAMP_OSINT), true);
  assert.equal(await sacarRegla(db, LINEA, CAMP_OSINT), false, "sacarla dos veces no miente");

  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000005:${LINEA}`, LINEA, AD_OSINT);
  assert.equal(quien, "ana");
});

test("cambiar de dueña PISA la regla, no acumula filas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");
  await ponerRegla(db, LINEA, CAMP_OSINT, "beto", "estephano");

  const filas = await db.select().from(campanaRuteo).where(eq(campanaRuteo.campanaId, CAMP_OSINT));
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.vendedoraId, "beto");
  assert.equal(filas[0]!.asignadaPor, "estephano", "queda rastro de quién la puso");
});

// ── La foto que ve la pantalla ───────────────────────────────────────────────

test("agrupa los anuncios en campañas y cuenta PERSONAS, no mensajes", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await ponerRegla(db, LINEA, CAMP_OSINT, "caro", "estephano");

  await sembrarLlegada(db, AD_OSINT, "51911111111");
  await sembrarLlegada(db, AD_OSINT_2, "51922222222");
  await sembrarLlegada(db, AD_INTELIGENCIA, "51933333333");

  const foto = await fotoDeRouting(db, LINEA);

  assert.equal(foto.campanas.length, 2, "trece anuncios pueden ser dos campañas");
  // Activa primero: es la que puede traer gente mañana.
  const [osint, inteligencia] = foto.campanas;
  assert.equal(osint!.campanaId, CAMP_OSINT);
  assert.equal(osint!.estado, "activa");
  assert.equal(osint!.anuncios, 2);
  assert.equal(osint!.personas, 2);
  assert.equal(osint!.vendedoraId, "caro");
  assert.equal(inteligencia!.estado, "pausada");
  assert.equal(inteligencia!.vendedoraId, null);
  assert.equal(foto.anunciosSinResolver, 0);
});

/**
 * 🔴 SIN ESTE NÚMERO LA PANTALLA AFIRMARÍA «ESTAS SON TODAS» sobre una lista
 * incompleta: un anuncio sin resolver no aparece en ninguna campaña.
 */
test("un anuncio que trajo gente y no está resuelto se CUENTA, no se esconde", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await sembrarLlegada(db, AD_OSINT, "51911111111");
  await sembrarLlegada(db, "9999-estrenado-hoy", "51944444444");

  const foto = await fotoDeRouting(db, LINEA);

  assert.equal(foto.campanas.length, 1);
  assert.equal(foto.anunciosSinResolver, 1);
});

test("fuera de la ventana no se cuenta: la cola mira 30 días y esto también", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  const haceCuarenta = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await sembrarLlegada(db, AD_OSINT, "51955555555", haceCuarenta);

  const foto = await fotoDeRouting(db, LINEA);
  assert.deepEqual(foto.campanas, []);
});
