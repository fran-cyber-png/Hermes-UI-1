import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { COMO_SUPERVISORA, COMO_VENDEDORA } from "../pruebas/rol.js";
import { numerosWa, numeroVendedora } from "../db/schema.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola, plegarConteos } from "./consultarCola.js";

/**
 * LA COSTURA DE «LÍNEA PROPIA»: DE `numeros_wa` HASTA EL `WHERE` Y LA RESPUESTA.
 *
 * ── Qué pidió el dueño (18-ago-2026) ────────────────────────────────────────
 *
 * «Los que se enlazan con qr también deberían poder el ventas meta, solo los 2 —
 * pero de ventas meta solo los que le asignaron a ellos». O sea: quien trajo su
 * número escaneando el QR ve **su línea entera** más **lo asignado a él en
 * cualquier otra**, y nada más.
 *
 * ── Por qué este archivo existe además de los dos que ya había ──────────────
 *
 * `lineaPropia.test.ts` fija la REGLA (pura) y `repositorio.test.db.ts` fija el
 * CONTEO que la alimenta. Ninguno de los dos puede ver el defecto que de verdad
 * paga este frente: que la regla esté escrita, testeada… y **no cableada**. Es
 * la lección de ADR 0024 —el Escape estaba testeado hasta el hueso y la app lo
 * perdió en el CABLEADO— y en este mismo archivo tuvo su versión: `conLineaPropia`
 * vivió clavado en `false` en `consultarCola` con toda la regla en verde.
 *
 * ── Lo que NO prueba ────────────────────────────────────────────────────────
 *
 * Que el hilo, la ficha o el envío nieguen nada. Siguen sirviendo cualquier
 * conversación a cualquier token (`docs/auditoria-aislamiento-de-chats-2026-08-17.md`):
 * esto es un recorte de la LISTA. Decir más sería una frontera imaginaria.
 */

/** La línea que trajo Walter por QR: propósito `vendedora` y **una** persona. */
const PROPIA = "51941654039";
/** «Ventas Meta»: dice `vendedora` igual, y la comparten varias. */
const COMPARTIDA = "51984429504";
/** Una línea retirada: nadie la declara en `numero_vendedora`. Acá vive el archivo. */
const RETIRADA = "51986394450";

const WALTER = "walter";
const LUZ = "luz";

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

async function sembrarLinea(db: Db, numero: string, proposito: string, vendedoras: string[]) {
  await db.insert(numerosWa).values({ numero, etiqueta: numero, proposito }).onConflictDoNothing();
  if (vendedoras.length) {
    await db
      .insert(numeroVendedora)
      .values(vendedoras.map((vendedoraId) => ({ numero, vendedoraId })))
      .onConflictDoNothing();
  }
}

async function asignar(db: Db, telefono: string, linea: string, aQuien: string) {
  await db.insert(conversacionAsignada).values({
    clave: `conv:whatsapp:${telefono}:${linea}`,
    numeroPropio: linea,
    vendedoraId: aQuien,
    motivo: "manual",
    asignadaPor: "test",
  });
}

/**
 * La mesa mínima que distingue las tres ramas de `lineaAlcanzableSql`, con el
 * reparto real de producción: **Walter no está en el mapa de «Ventas Meta»**
 * (medido el 18-ago-2026: la comparten siete y ninguna es él), así que de ahí
 * sólo le puede llegar lo que lleve su nombre.
 */
async function sembrarLaMesa(db: Db) {
  await sembrarLinea(db, PROPIA, "vendedora", [WALTER]);
  await sembrarLinea(db, COMPARTIDA, "vendedora", [LUZ, "Sindy", "ventas10@grupogoberna.com"]);
  await sembrarLinea(db, RETIRADA, "escuela", []);

  await sembrarMensaje(db, { personaId: "51900000001", personaNombre: "SIN_DUENA_EN_LA_SUYA", numeroPropio: PROPIA });
  await sembrarMensaje(db, { personaId: "51900000002", personaNombre: "ASIGNADA_A_WALTER", numeroPropio: COMPARTIDA });
  await sembrarMensaje(db, { personaId: "51900000003", personaNombre: "DE_LUZ", numeroPropio: COMPARTIDA });
  await sembrarMensaje(db, { personaId: "51900000004", personaNombre: "SIN_DUENA_EN_META", numeroPropio: COMPARTIDA });
  await sembrarMensaje(db, { personaId: "51900000005", personaNombre: "ARCHIVO_DE_LINEA_MUERTA", numeroPropio: RETIRADA });

  await asignar(db, "51900000002", COMPARTIDA, WALTER);
  await asignar(db, "51900000003", COMPARTIDA, LUZ);
}

async function cola(db: Db, vendedoraId: string, rol = COMO_VENDEDORA) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 }, rol);
  const nombres = (r.conversaciones as { persona_nombre: string | null }[]).map((c) => c.persona_nombre);
  return { r, nombres };
}

test("🔴 quien trajo su línea ve la SUYA entera y de la compartida sólo lo que lleva su nombre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(nombres.includes("SIN_DUENA_EN_LA_SUYA"), `su línea va entera — vio: ${nombres.join(", ")}`);
  assert.ok(nombres.includes("ASIGNADA_A_WALTER"), `lo asignado en otra línea también — vio: ${nombres.join(", ")}`);
  assert.ok(!nombres.includes("DE_LUZ"), "el trabajo de otra persona no se sirve");
  assert.ok(
    !nombres.includes("SIN_DUENA_EN_META"),
    "y lo huérfano de una línea que no es suya tampoco: de Ventas Meta sólo lo asignado",
  );
});

/**
 * 🔴 ACÁ ESTABAN LAS 2.879 CONVERSACIONES DE WALTER Y LAS 5.577 DE USUARIO1.
 *
 * Medido con `npm run frontera:preflight` contra producción el 18-ago-2026: de
 * las 2.930 filas que la cola le servía a Walter, 51 eran suyas y 2.879 entraban
 * por la rama de «la línea no tiene dueña» — el archivo de las líneas apagadas,
 * que al no tener fila en `numero_vendedora` quedan alcanzables para cualquiera.
 * Quitar esa rama a quien trajo su propio número es TODO el cambio pedido.
 */
test("🔴 el archivo de una línea apagada deja de caerle a quien tiene línea propia", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    !nombres.includes("ARCHIVO_DE_LINEA_MUERTA"),
    `no tiene nada que hacer en el archivo de una línea retirada — vio: ${nombres.join(", ")}`,
  );
});

/**
 * ⚠️ EL CANDADO DEL RESTO DEL EQUIPO. `conLineaPropia = false` tiene que ser
 * IDÉNTICO a lo de antes de este frente: es lo que ven Luz, Sindy y las cinco
 * `ventas1X`, o sea casi todo el mundo. Si este test se pone rojo, el cambio se
 * le escapó a las personas a las que no se les tocó nada.
 */
test("quien NO tiene línea propia sigue viendo lo huérfano de las líneas sin dueña", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, LUZ);
  assert.ok(nombres.includes("ARCHIVO_DE_LINEA_MUERTA"), `Luz sigue viendo el archivo — vio: ${nombres.join(", ")}`);
  assert.ok(nombres.includes("SIN_DUENA_EN_META"), "y lo huérfano de la línea que sí es suya");
  assert.ok(nombres.includes("DE_LUZ"), "y lo suyo, que es lo que la frontera nunca le tocó");
  assert.equal(r.conLineaPropia, undefined, "y la respuesta NO afirma una línea propia que no tiene");
});

/**
 * 🔴 LA CABECERA TIENE QUE DECIR EL MISMO NÚMERO QUE LA LISTA.
 *
 * Es la cicatriz de #390, con otro recorte encima: la frontera entraba sólo a la
 * consulta de la PÁGINA, así que a Sindy le servían 3.095 filas bajo un
 * encabezado que decía 5.494 — y cada chip y cada columna del Pipeline con el
 * mismo hueco. Se lee como «la app perdió mis conversaciones», y además el número
 * le cuenta a esa persona cuánto trabajo tiene la otra. Este test mira las CUATRO
 * cifras que salen del mismo pedido.
 */
test("🔴 total, conteos, desglose y los chips cuentan sobre la MISMA cola recortada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, WALTER);
  assert.equal(nombres.length, 2, `sólo su línea y lo asignado — vio: ${nombres.join(", ")}`);
  assert.equal(r.total, nombres.length, "el encabezado dice lo que la lista trae");

  const porEtapa = r.conteos ?? {};
  const sumaEtapas = Object.values(porEtapa).reduce((a, b) => a + b, 0);
  assert.equal(sumaEtapas, nombres.length, "las columnas del embudo suman la cola recortada");

  const sumaDesglose = (r.desglose ?? []).reduce((a, f) => a + f.n, 0);
  assert.equal(sumaDesglose, nombres.length, "el desglose del Pipeline mira el mismo universo");
  assert.deepEqual(plegarConteos(r.desglose ?? []), porEtapa, "y los conteos se pliegan de ese desglose");

  // Los chips no pueden prometer trabajo que la cola no va a mostrar.
  for (const [chip, n] of Object.entries(r.conteosFiltro ?? {})) {
    assert.ok(n <= nombres.length, `el chip \`${chip}\` promete ${n} sobre una cola de ${nombres.length}`);
  }
});

/**
 * 🔴 EL ORDEN IMPORTA: `veTodo` GANA ANTES QUE ESTO.
 *
 * `usuario1` tiene línea propia **y es admin** en producción. Si esta regla se
 * evaluara primero, le recortaría la mesa a quien reparte —y no se puede repartir
 * lo que no se ve—, haciendo falso a D4: la frontera es propiedad del ROL.
 * Acotar a un admin es cambiarle el rol, que es operación y no código.
 */
test("🔴 una supervisora con línea propia sigue viendo la mesa entera, y no se le anuncia recorte", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, WALTER, COMO_SUPERVISORA);
  assert.ok(nombres.includes("DE_LUZ"), `supervisa: ve el trabajo de todas — vio: ${nombres.join(", ")}`);
  assert.ok(nombres.includes("ARCHIVO_DE_LINEA_MUERTA"), "incluido el archivo");
  assert.equal(r.colaRecortada, undefined, "no hay recorte que anunciar");
  assert.equal(
    r.conLineaPropia,
    undefined,
    "y `lineaPropia` se deriva del recorte APLICADO, no de tener una línea: si no, el cartel mentiría",
  );
});

/**
 * La bandera existe porque el día del deploy esta cola puede ser CASI NADA y eso
 * hay que explicarlo. Nadie va a ser agregado a la rueda del reparto —el dueño
 * asigna a mano después—, así que Walter y Usuario1 arrancan con **cero** filas
 * en `conversacion_asignada` sobre la línea compartida (medido el 18-ago-2026:
 * ahí sólo hay filas de luz, Sindy, ventas10-14 y Tracy). Una lista corta sin una
 * palabra al lado se lee «se perdieron las conversaciones».
 */
test("la respuesta DICE que la cola es su línea propia — sin nada asignado, no queda muda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLinea(db, PROPIA, "vendedora", [WALTER]);
  await sembrarLinea(db, COMPARTIDA, "vendedora", [LUZ]);
  await sembrarMensaje(db, { personaId: "51900000009", personaNombre: "DE_LUZ", numeroPropio: COMPARTIDA });
  await asignar(db, "51900000009", COMPARTIDA, LUZ);

  const { r, nombres } = await cola(db, WALTER);
  assert.deepEqual(nombres, [], "todavía no le asignaron nada y su línea no tiene tráfico");
  assert.equal(r.conLineaPropia, true, "pero la pantalla puede explicar POR QUÉ está vacía");
  assert.equal(r.colaRecortada, true, "y que hay un recorte puesto");
});
