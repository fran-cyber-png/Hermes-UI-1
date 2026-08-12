import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { conversacionAsignada, repartoRueda } from "../db/reparto.js";
import { campanaAnuncio, campanaRuteo } from "../db/routing.js";
import { asignarSiHaceFalta } from "../reparto/asignar.js";
import { campanaMeta } from "../db/routing.js";
import { duenosPorCampana, fotoDeRouting, ponerCables, guardarCampanas } from "./repositorio.js";

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

/**
 * El catálogo de campañas como lo deja `refrescar`. **La lista de la pantalla
 * sale de acá, no de `events`**: por eso una campaña sin un solo lead igual se
 * puede configurar.
 */
async function sembrarCatalogo(db: Db, numerosOsint = [LINEA]) {
  await guardarCampanas(db, [
    { campanaId: CAMP_OSINT, nombre: "[AGO] OSINT", estado: "ACTIVE", numeros: numerosOsint },
    {
      campanaId: CAMP_INTELIGENCIA,
      nombre: "[JUL] INTELIGENCIA | WSP",
      estado: "PAUSED",
      numeros: [LINEA],
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
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");

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
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");

  // Es el punto de rutear por campaña y no por anuncio: los cuatro anuncios de
  // la campaña de agosto son una sola decisión.
  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000002:${LINEA}`, LINEA, AD_OSINT_2);
  assert.equal(quien, "caro");
});

test("una campaña SIN regla se reparte por la rueda, como siempre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");

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
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");

  assert.deepEqual(await duenosPorCampana(db, LINEA, null), [], "sin anuncio");
  assert.deepEqual(await duenosPorCampana(db, LINEA, "  "), [], "un anuncio en blanco");
  assert.deepEqual(await duenosPorCampana(db, LINEA, "9999-estrenado-hoy"), [], "sin resolver");
  assert.deepEqual(await duenosPorCampana(db, LINEA, AD_INTELIGENCIA), [], "campaña sin regla");
  assert.deepEqual(await duenosPorCampana(db, "51986394450", AD_OSINT), [], "la regla es POR LÍNEA");
});

test("la regla NO reasigna lo ya repartido", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  const clave = `conv:whatsapp:51900000004:${LINEA}`;

  const primero = await asignarSiHaceFalta(db, clave, LINEA, AD_OSINT);
  assert.equal(primero, "ana", "sin regla todavía: rueda");

  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");
  const segundo = await asignarSiHaceFalta(db, clave, LINEA, AD_OSINT);

  assert.equal(segundo, "ana", "una conversación no cambia de manos a mitad de la charla");
});

test("el PUT REEMPLAZA el conjunto de cables, no lo acumula", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro", "beto"], "estephano");
  await ponerCables(db, LINEA, CAMP_OSINT, ["beto"], "estephano");

  const filas = await db.select().from(campanaRuteo).where(eq(campanaRuteo.campanaId, CAMP_OSINT));
  assert.equal(filas.length, 1, "el cable de caro se cortó al mandar el conjunto sin ella");
  assert.equal(filas[0]!.vendedoraId, "beto");
  assert.equal(filas[0]!.asignadaPor, "estephano", "queda rastro de quién lo puso");
});

/**
 * 🔴 EL CORAZÓN DEL FRENTE: varias conectadas es una rueda chica, y adentro se
 * elige por CARGA. Sin esto, «conectar a dos» sería o mandarle todo a una o
 * dejar el lead sin dueño.
 */
test("con dos cables, los leads se reparten entre esas dos y nadie más", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerCables(db, LINEA, CAMP_OSINT, ["beto", "caro"], "estephano");

  const tocaron: string[] = [];
  for (let i = 0; i < 4; i++) {
    tocaron.push((await asignarSiHaceFalta(db, `conv:whatsapp:5190000010${i}:${LINEA}`, LINEA, AD_OSINT))!);
  }

  assert.deepEqual([...new Set(tocaron)].sort(), ["beto", "caro"], "solo las cableadas");
  assert.equal(tocaron.filter((t) => t === "beto").length, 2, "y parejo entre ellas");
  assert.equal(tocaron.filter((t) => t === "caro").length, 2);
  assert.equal(tocaron.includes("ana"), false, "«ana» es la primera de la rueda general y NO entra");
});

test("cortar todos los cables devuelve la campaña a la rueda general", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarRueda(db);
  await sembrarAnuncios(db);
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");
  await ponerCables(db, LINEA, CAMP_OSINT, [], "estephano");

  const quien = await asignarSiHaceFalta(db, `conv:whatsapp:51900000200:${LINEA}`, LINEA, AD_OSINT);
  assert.equal(quien, "ana", "la primera de la rueda general");
});

// ── La foto que ve la pantalla ───────────────────────────────────────────────

test("agrupa los anuncios en campañas y cuenta PERSONAS, no mensajes", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await sembrarCatalogo(db);
  await ponerCables(db, LINEA, CAMP_OSINT, ["caro"], "estephano");

  await sembrarLlegada(db, AD_OSINT, "51911111111");
  await sembrarLlegada(db, AD_OSINT_2, "51922222222");
  await sembrarLlegada(db, AD_INTELIGENCIA, "51933333333");

  const foto = await fotoDeRouting(db, LINEA);

  assert.equal(foto.campanas.length, 2, "diecisiete anuncios pueden ser dos campañas");
  // Activa primero: es la que puede traer gente mañana.
  const [osint, inteligencia] = foto.campanas;
  assert.equal(osint!.campanaId, CAMP_OSINT);
  assert.equal(osint!.estado, "activa");
  assert.equal(osint!.anuncios, 2);
  assert.equal(osint!.personas, 2);
  assert.deepEqual(osint!.vendedoras, ["caro"]);
  assert.equal(inteligencia!.estado, "pausada");
  assert.deepEqual(inteligencia!.vendedoras, [], "sin cables: va a la rueda");
  assert.equal(foto.anunciosSinResolver, 0);
});

/**
 * 🔴 SIN ESTE NÚMERO LA PANTALLA AFIRMARÍA «ESTAS SON TODAS» sobre una lista
 * incompleta: un anuncio sin resolver no aparece en ninguna campaña.
 */
test("un anuncio que trajo gente y no está resuelto se CUENTA, no se esconde", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await sembrarCatalogo(db);
  await sembrarLlegada(db, AD_OSINT, "51911111111");
  await sembrarLlegada(db, "9999-estrenado-hoy", "51944444444");

  const foto = await fotoDeRouting(db, LINEA);

  assert.equal(foto.anunciosSinResolver, 1);
  // Y su volumen no se le suma a ninguna campaña: no se sabe de cuál es.
  assert.equal(foto.campanas.reduce((n, c) => n + c.personas, 0), 1);
});

test("fuera de la ventana no se cuenta: la cola mira 30 días y esto también", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  const haceCuarenta = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await sembrarLlegada(db, AD_OSINT, "51955555555", haceCuarenta);

  const foto = await fotoDeRouting(db, LINEA);
  assert.deepEqual(foto.campanas, []);
});

// ── De dónde sale la lista ───────────────────────────────────────────────────

/**
 * 🔴 EL CASO QUE JUSTIFICA TRAER EL CATÁLOGO DE META. Una campaña estrenada hoy
 * no tiene un solo lead, y es EXACTAMENTE cuando querés dejar el cable puesto.
 * Con la lista derivada de `events` era invisible hasta que entrara el primero.
 */
test("una campaña sin un solo lead igual aparece y se puede cablear", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);

  const foto = await fotoDeRouting(db, LINEA);

  assert.equal(foto.campanas.length, 2);
  assert.equal(foto.campanas.every((c) => c.personas === 0), true, "todavía no trajeron a nadie");
});

/**
 * 🔴 Y EL QUE JUSTIFICA EL FILTRO POR LÍNEA. Medido el 12-ago-2026: de 17 adsets
 * activos, 16 mandan a números que Hermes no atiende. Ofrecer un cable ahí sería
 * ofrecer uno que no puede llevar nada — el lead entra por otro teléfono.
 */
test("la campaña que apunta a OTRO número no se lista, pero se cuenta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db, ["51986394450"]); // OSINT manda a una línea caída

  const foto = await fotoDeRouting(db, LINEA);

  assert.deepEqual(foto.campanas.map((c) => c.campanaId), [CAMP_INTELIGENCIA]);
  assert.equal(foto.campanasEnOtraLinea, 1, "se cuenta: esconderla mentiría sobre el total");
});

test("una campaña que no manda a NINGÚN WhatsApp no es «de otra línea»: no es de este frente", async (t) => {
  const db = await baseDePrueba(t);
  await guardarCampanas(db, [
    { campanaId: "camp-web", nombre: "[AGO] LIBROS | CD", estado: "ACTIVE", numeros: [] },
  ]);

  const foto = await fotoDeRouting(db, LINEA);

  assert.deepEqual(foto.campanas, []);
  assert.equal(foto.campanasEnOtraLinea, 0);
});

test("sin catálogo todavía, la pantalla no inventa campañas", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAnuncios(db);
  await sembrarLlegada(db, AD_OSINT, "51911111111");

  const foto = await fotoDeRouting(db, LINEA);

  assert.deepEqual(foto.campanas, [], "hay que apretar «Actualizar desde Meta»");
  assert.equal(foto.sinMigracion, false);
});
