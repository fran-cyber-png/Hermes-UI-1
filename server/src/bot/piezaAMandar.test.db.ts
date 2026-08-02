import test from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarEnvioWa } from "../pruebas/sembrar.js";
import { hechos } from "../db/schema.js";
import { crearPlantilla, obtenerPlantilla, type PasoPlantilla } from "../plantillas/repositorio.js";
import { deUnDato, deUnPasoDePlantilla } from "../procedencia/pieza.js";
import { VENDEDORA_ID_DEL_BOT } from "./frenos.js";
import { leerPiezaDelBot, piezasYaEnviadas } from "./piezaAMandar.js";

/**
 * EL LECTOR DEL BOT Y EL DEDUPE, contra Postgres de verdad (ADR 0008).
 *
 * Las dos cosas que se fijan acá no se pueden fijar sin base, y las dos son
 * regresiones que ya tenían dueño:
 *
 *   · que el bot **vea las plantillas de las vendedoras** (el lector de la app
 *     filtra por `visiblePara` y para el id `bot` devuelve `null`);
 *   · que una pieza que ya salió en esa conversación **no vuelva a salir**,
 *     incluso si la mandó una persona a mano.
 */

const LUZ = "luz";
const TELEFONO = "51961506674";
const LINEA_DEL_BOT = "51984429504";
const CLAVE = `conv:whatsapp:${TELEFONO}:${LINEA_DEL_BOT}`;

const paso = (p: Partial<PasoPlantilla> & { orden: number }): PasoPlantilla => ({
  texto: `paso ${p.orden}`,
  media: null,
  mediaPendiente: false,
  ...p,
});

test("🔴 el bot LEE una plantilla aprobada por una vendedora — el lector de la app no", async (t) => {
  const db = await baseDePrueba(t);
  const suya = await crearPlantilla(db, LUZ, {
    nombre: "Flyer Inteligencia",
    familiaCurso: "DIPICOT",
    pasos: [paso({ orden: 1 })],
  });

  // La prueba de que hacía falta un lector nuevo: con el de la app, el bot no ve
  // nada — `visiblePara` solo deja pasar lo de esa vendedora (más las propuestas
  // del minado), y el bot firma como `bot`.
  assert.equal(
    await obtenerPlantilla(db, VENDEDORA_ID_DEL_BOT, suya.id),
    null,
    "obtenerPlantilla no le sirve al bot: por eso hay un lector propio",
  );

  const pieza = await leerPiezaDelBot(db, { clase: "plantilla", id: String(suya.id) });
  assert.ok(pieza, "el lector del bot sí la encuentra");
  assert.equal(pieza.vigente, true);
  assert.equal(pieza.familiaCurso, "DIPICOT");
  assert.equal(pieza.pasos.length, 1);
});

test("una propuesta del minado se lee, pero NO como vigente: una persona la aprueba primero", async (t) => {
  const db = await baseDePrueba(t);
  const propuesta = await crearPlantilla(
    db,
    LUZ,
    { nombre: "Minada", pasos: [paso({ orden: 1 })] },
    "propuesta",
  );

  const pieza = await leerPiezaDelBot(db, { clase: "plantilla", id: String(propuesta.id) });
  assert.ok(pieza);
  assert.equal(pieza.vigente, false, "GUARDA 1: el minado propone, una persona aprueba");
});

test("el adjunto viaja con MIME y nombre — sin eso no se puede mandar", async (t) => {
  const db = await baseDePrueba(t);
  // `catalogo/repositorio.ts` lee `media_archivo` (lo que entra en la versión) y
  // NO `media_mime`: alcanza para publicarle el catálogo a Ivi y no alcanza para
  // mandar, porque el transporte pide el mime.
  const conFlyer = await crearPlantilla(db, LUZ, {
    nombre: "Con flyer",
    pasos: [
      paso({
        orden: 1,
        media: { archivo: "flyer.jpg", mime: "image/jpeg", clase: "imagen", nombre: "Flyer" },
      }),
    ],
  });

  const pieza = await leerPiezaDelBot(db, { clase: "plantilla", id: String(conFlyer.id) });
  assert.equal(pieza?.pasos[0]?.media?.mime, "image/jpeg");
  assert.equal(pieza?.pasos[0]?.media?.nombre, "Flyer");
  assert.equal(pieza?.pasos[0]?.media?.clase, "imagen");
});

test("un paso que PIDE imagen y no la tiene queda marcado pendiente", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, LUZ, {
    nombre: "Falta el flyer",
    pasos: [paso({ orden: 1, mediaPendiente: true })],
  });
  const pieza = await leerPiezaDelBot(db, { clase: "plantilla", id: String(p.id) });
  assert.equal(pieza?.pasos[0]?.mediaPendiente, true);
});

test("un id que no es una plantilla no rompe la consulta: devuelve null", async (t) => {
  const db = await baseDePrueba(t);
  assert.equal(await leerPiezaDelBot(db, { clase: "plantilla", id: "no-soy-un-numero" }), null);
  assert.equal(await leerPiezaDelBot(db, { clase: "plantilla", id: "999999" }), null);
});

test("un hecho se lee como una pieza de un solo mensaje, sin familia", async (t) => {
  const db = await baseDePrueba(t);
  await db.insert(hechos).values({
    clave: "cuotas",
    rotulo: "Cuotas",
    texto: "Se puede pagar en 2 cuotas, sin recargo.",
  });

  const pieza = await leerPiezaDelBot(db, { clase: "hecho", id: "cuotas" });
  assert.equal(pieza?.vigente, true);
  assert.equal(pieza?.familiaCurso, null, "un hecho vale para cualquier curso");
  assert.equal(pieza?.pasos[0]?.texto, "Se puede pagar en 2 cuotas, sin recargo.");
});

test("un hecho apagado se lee pero no está vigente (apagar no es borrar)", async (t) => {
  const db = await baseDePrueba(t);
  await db
    .insert(hechos)
    .values({ clave: "viejo", rotulo: "Viejo", texto: "ya no va", activo: false });
  const pieza = await leerPiezaDelBot(db, { clase: "hecho", id: "viejo" });
  assert.equal(pieza?.vigente, false);
});

test("un acuse o un gancho NO son piezas que el bot mande: null, no un envío", async (t) => {
  const db = await baseDePrueba(t);
  assert.equal(await leerPiezaDelBot(db, { clase: "acuse", id: "fuera-de-horario" }), null);
  assert.equal(await leerPiezaDelBot(db, { clase: "gancho", id: "inteligencia" }), null);
});

// ── El dedupe ────────────────────────────────────────────────────────────────

test("una conversación sin envíos: la pieza no salió", async (t) => {
  const db = await baseDePrueba(t);
  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:12"), false);
});

test("🔴 si un PASO de la secuencia ya salió, la secuencia ya salió", async (t) => {
  const db = await baseDePrueba(t);
  // El lazo estampa el paso (`12#1`), no la plantilla: comparar la `ref` cruda
  // contra `"12"` daría siempre falso y el flyer saldría de nuevo cada turno.
  await sembrarEnvioWa(db, {
    referencia: CLAVE,
    telefono: TELEFONO,
    numeroPropio: LINEA_DEL_BOT,
    vendedoraId: VENDEDORA_ID_DEL_BOT,
    estado: "enviado",
    procedencia: deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "bot",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer.jpg" },
    }),
  });

  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:12"), true);
  // Y no confunde una plantilla con otra.
  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:1"), false);
});

test("🔴 el flyer que la VENDEDORA mandó a mano también cuenta", async (t) => {
  const db = await baseDePrueba(t);
  // El caso que ninguna guarda de adentro del bot podría ver: Luz ya se lo pasó
  // desde el panel y el bot no tiene por qué mandarlo otra vez.
  await sembrarEnvioWa(db, {
    referencia: CLAVE,
    telefono: TELEFONO,
    numeroPropio: LINEA_DEL_BOT,
    vendedoraId: LUZ,
    estado: "enviado",
    procedencia: deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "panel-secuencias",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer.jpg" },
    }),
  });

  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:12"), true);
});

test("un envío que NO salió (fallido o bloqueado) no cuenta: el lead no vio nada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, {
    referencia: CLAVE,
    telefono: TELEFONO,
    numeroPropio: LINEA_DEL_BOT,
    estado: "fallido",
    resueltoAt: null,
    procedencia: deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "bot",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer.jpg" },
    }),
  });

  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:12"), false);
});

test("lo que salió en OTRA conversación no frena esta", async (t) => {
  const db = await baseDePrueba(t);
  const otra = `conv:whatsapp:51900000001:${LINEA_DEL_BOT}`;
  await sembrarEnvioWa(db, {
    referencia: otra,
    telefono: "51900000001",
    numeroPropio: LINEA_DEL_BOT,
    estado: "enviado",
    procedencia: deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "bot",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer.jpg" },
    }),
  });

  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("plantilla:12"), false);
});

test("un hecho ya dicho tampoco se repite, y no se cruza con una plantilla", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarEnvioWa(db, {
    referencia: CLAVE,
    telefono: TELEFONO,
    numeroPropio: LINEA_DEL_BOT,
    estado: "enviado",
    procedencia: deUnDato({
      clave: "cuotas",
      editada: false,
      contenido: { texto: "Se puede pagar en 2 cuotas." },
      via: "bot",
    }),
  });

  assert.equal((await piezasYaEnviadas(db, CLAVE)).has("hecho:cuotas"), true);
  assert.equal(
    (await piezasYaEnviadas(db, CLAVE)).has("plantilla:cuotas"),
    false,
    "la clase es parte de la identidad",
  );
});
