import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { COMO_SUPERVISORA, COMO_VENDEDORA, comoRol } from "../pruebas/rol.js";
import { conversacionAsignada } from "../db/reparto.js";
import { consultarCola, plegarConteos } from "./consultarCola.js";

/**
 * QUIEN TRAJO SU PROPIA LÍNEA VE UNA RAMA MENOS — CONTRA LA FORMA REAL DE PROD.
 *
 * ══ QUÉ SE PIDIÓ ═════════════════════════════════════════════════════════════
 *
 * Dueño, 18-ago-2026: «los que se enlazan con qr también deberían poder el ventas
 * meta, solo los 2 — pero de ventas meta solo los que le asignaron a ellos». O
 * sea: quien vinculó su número escaneando el QR ve **su línea entera** más **lo
 * asignado a él en cualquier otra**, y nada más. En el `WHERE` eso no es una
 * regla nueva: es la tercera rama de `lineaAlcanzableSql` («la línea no tiene
 * dueña») cayéndose, condicionada (`asignadaSql.ts` §RAMA_LINEA_SIN_DUENA).
 *
 * ══ 🔴 LO QUE ESTE ARCHIVO APORTA ES LA SIEMBRA, NO LAS AFIRMACIONES ═════════
 *
 * `lineaPropia.test.ts` fija la regla pura, `numeros/repositorio.test.db.ts` el
 * conteo que la alimenta y `consultarCola.lineaPropia.test.db.ts` el cableado.
 * Acá la mesa se siembra con **la forma medida en producción el 18-ago-2026**, y
 * esa forma es la mitad del frente:
 *
 *   numero        etiqueta        proposito    personas
 *   51984429504   Ventas Meta     vendedora    **7**   ← el caso que rompe todo
 *   51941654039   Walter Ventas   vendedora    1
 *   51986394450   Ventas Perú     escuela      0       ← acá vive el archivo
 *
 * 🔴 **Con una siembra de tres personas en Ventas Meta, una regla escrita como
 * `proposito === 'vendedora'` a secas pasa TODOS los tests de este frente** — y
 * en producción le daría la línea entera de la Escuela a Luz, a Sindy y a las
 * cinco `ventas1X`. El repo ya pagó dos veces por sembrar el caso ideal (los
 * cuatro envíos de la misma persona y la rueda cargada, ADR 0051): los defectos
 * los encontró correr contra una copia de prod, no un test.
 *
 * ⚠️ **Se solapa a propósito con `consultarCola.lineaPropia.test.db.ts`** en las
 * cuatro afirmaciones centrales. No es copiar: allá la misma frase se prueba
 * sobre una mesa mínima —tres personas en la compartida, sin leads y con una sola
 * grafía— y lo que se fija acá es que **siga siendo cierta con la mesa que hay
 * del otro lado**. Si alguien consolida los dos archivos, lo que no se puede
 * perder es esta siembra.
 *
 * ══ ⚠️ ES UN FILTRO DE LA LISTA, NO UN PERMISO ═══════════════════════════════
 *
 * `docs/auditoria-aislamiento-de-chats-2026-08-17.md` lo midió: la cola es la
 * ÚNICA superficie con recorte. El hilo, la ficha y el envío siguen sirviendo
 * cualquier conversación a cualquier token, así que ningún test de acá autoriza
 * a decir «los datos de una no los ve la otra». Lo que se garantiza es que **no
 * aparezca en la cola de quien no la trabaja**. Prometer más sería una frontera
 * imaginaria: peor que ninguna, porque se le cree.
 */

/** La que trajo Walter por QR: `proposito` vendedora y **una** persona. */
const PROPIA = "51941654039";
/** «Ventas Meta»: dice `vendedora` IGUAL, y la comparten siete. */
const VENTAS_META = "51984429504";
/** Retirada el 11-ago-2026: nadie la declara en `numero_vendedora`. Acá vive el archivo. */
const RETIRADA = "51986394450";

/**
 * 🔴 **La grafía cruda del mapa, y no es decorativa.** Cerberus empuja `Walter` a
 * `numero_vendedora` y él entra al login en minúscula: si alguna de las dos
 * comparaciones se hiciera exacta, no habría error — habría que Walter deja de
 * reconocer su propia línea (ver el test de las dos grafías, abajo).
 */
const WALTER_EN_EL_MAPA = "Walter";
const WALTER = "walter";
const LUZ = "luz";

/** Las siete de Ventas Meta, tal cual el mapa de producción. */
const LAS_SIETE_DE_VENTAS_META = [
  LUZ,
  "Sindy",
  "ventas10@grupogoberna.com",
  "ventas11@grupogoberna.com",
  "ventas12@grupogoberna.com",
  "ventas13@grupogoberna.com",
  "ventas14@grupogoberna.com",
];

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

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
 * LA MESA, con las tres líneas de producción y las cinco filas que distinguen
 * las ramas del predicado. El sexto renglón es un **lead de formulario**, que no
 * entró por ninguna línea nuestra: está para que se note si alguien se lo lleva
 * puesto (ver el test que lo cuida).
 */
async function sembrarLaMesa(db: Db) {
  await sembrarLineaDeVendedora(db, PROPIA, [WALTER_EN_EL_MAPA], "vendedora");
  await sembrarLineaDeVendedora(db, VENTAS_META, LAS_SIETE_DE_VENTAS_META, "vendedora");
  // Sin una sola fila en `numero_vendedora`: es lo que la hace alcanzable para
  // todo el mundo, y de ahí salen las 2.879 huérfanas que este frente le quita.
  await sembrarLineaDeVendedora(db, RETIRADA, [], "escuela");

  await sembrarMensaje(db, {
    personaId: "51900000001",
    personaNombre: "HUERFANA_DE_SU_LINEA",
    numeroPropio: PROPIA,
  });
  await sembrarMensaje(db, {
    personaId: "51900000002",
    personaNombre: "ASIGNADA_A_WALTER_EN_META",
    numeroPropio: VENTAS_META,
  });
  await sembrarMensaje(db, {
    personaId: "51900000003",
    personaNombre: "DE_LUZ_EN_META",
    numeroPropio: VENTAS_META,
  });
  await sembrarMensaje(db, {
    personaId: "51900000004",
    personaNombre: "HUERFANA_EN_META",
    numeroPropio: VENTAS_META,
  });
  await sembrarMensaje(db, {
    personaId: "51900000005",
    personaNombre: "ARCHIVO_DE_LINEA_RETIRADA",
    numeroPropio: RETIRADA,
  });
  // Un formulario: `numero_propio IS NULL`, así que ninguna línea lo reclama.
  await sembrarLead(db, {
    platform: "web",
    formName: "icarus:landing",
    phone: "+51987650001",
    fullName: "FORMULARIO_SIN_LINEA",
  });

  // La asignación va con la grafía CRUDA, que es como la escribe producción.
  await asignar(db, "51900000002", VENTAS_META, WALTER_EN_EL_MAPA);
  await asignar(db, "51900000003", VENTAS_META, LUZ);
}

async function cola(db: Db, vendedoraId: string, rol = COMO_VENDEDORA) {
  const r = await consultarCola(db, { vendedoraId, limit: 50 }, rol);
  const nombres = (r.conversaciones as { persona_nombre: string | null }[]).map(
    (c) => c.persona_nombre,
  );
  return { r, nombres };
}

/**
 * 🔴 EL TEST QUE JUSTIFICA EL FRENTE ENTERO.
 *
 * Medido con `npm run frontera:preflight` contra producción el 18-ago-2026: de
 * las 2.930 filas que la cola le servía a Walter, **51 eran suyas y 2.879
 * entraban por la rama de «la línea no tiene dueña»** — el archivo de las líneas
 * apagadas (`51986394450` sin un entrante desde el 28-jul, `51944531711` sin
 * tráfico nunca), que al no tener fila en `numero_vendedora` quedan alcanzables
 * para cualquiera. Lo mismo con Usuario1: 5.577 de 5.628.
 */
test("🔴 el archivo de una línea RETIRADA deja de caerle a quien tiene línea propia", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    !nombres.includes("ARCHIVO_DE_LINEA_RETIRADA"),
    `quien trajo su número no tiene nada que hacer en el archivo de una línea apagada — vio: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 LA MITAD QUE EL DUEÑO PIDIÓ EXPLÍCITO: «también deberían poder el ventas
 * meta». Sin esto, quitarle la rama huérfana lo dejaría encerrado en su propia
 * línea — que es justo lo contrario. Y no hace falta ninguna regla nueva para
 * conseguirlo: lo trae `lower(btrim(dueño)) = yo`, la PRIMERA condición de
 * `fronteraDeAsignacionSql`.
 */
test("🔴 SÍ ve lo que le asignaron en Ventas Meta, aunque esa línea no sea suya", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    nombres.includes("ASIGNADA_A_WALTER_EN_META"),
    `lo asignado en otra línea le corresponde — vio: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 «SOLO LOS QUE LE ASIGNARON A ELLOS» ES UNA PROPIEDAD, NO UNA FRASE.
 *
 * Sin este test, «ve Ventas Meta» y «ve lo suyo de Ventas Meta» pasan los dos:
 * la diferencia son las 4.996 filas que hoy ve Luz. Se afirman las dos mitades
 * —el trabajo de otra persona y lo que todavía no tiene dueño— porque se caen
 * por motivos distintos del predicado.
 */
test("🔴 de Ventas Meta NO ve ni lo de otra persona ni lo que nadie agarró todavía", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    !nombres.includes("DE_LUZ_EN_META"),
    `el trabajo de otra persona no se sirve — vio: ${nombres.join(", ")}`,
  );
  assert.ok(
    !nombres.includes("HUERFANA_EN_META"),
    `y lo huérfano de una línea ajena tampoco: de Ventas Meta, sólo lo asignado — vio: ${nombres.join(", ")}`,
  );
});

/**
 * SU LÍNEA VA ENTERA — lo suyo **y lo que todavía no agarró nadie EN ELLA**.
 *
 * ⚠️ Es la asimetría del frente y se lee mal si no se dice: lo huérfano de una
 * línea ajena se cae, lo huérfano de la propia se queda. Lo trae la rama de «la
 * línea es mía» (`ramaLineaMiaSql`), que este cambio no toca.
 */
test("su línea propia va ENTERA: también lo que todavía no tiene dueña ahí", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    nombres.includes("HUERFANA_DE_SU_LINEA"),
    `en su propia línea lo huérfano sigue siendo de quien lo agarre — vio: ${nombres.join(", ")}`,
  );
});

/**
 * ⚠️ EL FORMULARIO NO SE VA «DE PASO», Y ESO ES UNA DECISIÓN ESCRITA.
 *
 * Es lo primero que uno saca al leer «ve su línea entera más lo que le
 * asignaron»: un lead no está en ninguna de las dos bolsas. Pero ADR 0051 los
 * exime del reparto **a propósito** —nadie les escribió todavía, así que no
 * pueden tener dueño y no hay a quién asignárselos—, y sacarlos le apagaría a
 * Walter y a Usuario1 ~154 tarjetas de trabajo real. Si este test se pone rojo,
 * alguien quitó `RAMA_SIN_LINEA` creyendo que sobraba.
 */
test("⚠️ los leads de formulario se conservan: `numero_propio IS NULL` no es de ninguna línea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    nombres.includes("FORMULARIO_SIN_LINEA"),
    `el formulario no entró por ninguna línea nuestra: nadie se lo puede quedar — vio: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 EL CANDADO CONTRA EL DESPARRAMO — y es el que la siembra hace posible.
 *
 * Luz comparte Ventas Meta con seis más, así que **no** tiene línea propia y su
 * cola tiene que quedar EXACTAMENTE como antes del frente. Con la regla atada
 * sólo al `proposito` —que en producción dice `vendedora` también para Ventas
 * Meta— este test es el único de todo el frente que se pone rojo: los otros
 * pasan igual, porque a Walter no le cambia nada. Es todo el equipo de la
 * Escuela el que se enteraría en producción.
 */
test("🔴 quien comparte su línea con seis más NO cambia de cola", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, LUZ);
  assert.ok(nombres.includes("DE_LUZ_EN_META"), `lo suyo — vio: ${nombres.join(", ")}`);
  assert.ok(nombres.includes("HUERFANA_EN_META"), "lo huérfano de la línea que sí es suya");
  assert.ok(
    nombres.includes("ARCHIVO_DE_LINEA_RETIRADA"),
    "y el archivo de la línea sin dueña, que es lo que este frente NO le toca",
  );
  assert.ok(!nombres.includes("ASIGNADA_A_WALTER_EN_META"), "menos el trabajo de otra persona");
  assert.ok(
    !nombres.includes("HUERFANA_DE_SU_LINEA"),
    "y menos lo huérfano de una línea que el mapa le declara a Walter",
  );
  assert.equal(r.conLineaPropia, undefined, "y la respuesta no le afirma una línea propia que no tiene");
});

/**
 * 🔴 LAS DOS GRAFÍAS DEL MISMO HUMANO, Y ACÁ FALLA MUDO.
 *
 * En producción conviven `Walter` (lo empuja Cerberus a `numero_vendedora`) y
 * `walter` (lo que él tipea al entrar, de donde sale el `vendedoraId`). Con
 * comparación exacta no hay error ni log: hay que **Walter deja de reconocer su
 * propia línea**, y como esta regla ya le sacó lo huérfano ajeno, la cola le
 * queda en lo asignado y nada más.
 *
 * ⚠️ La afirmación discriminante es la huérfana de SU línea: lo asignado le
 * llegaría igual por el dueño, así que un test que sólo mirara eso pasaría con la
 * comparación rota.
 */
test("🔴 `Walter` en el mapa y `walter` en el token son la misma persona: reconoce su línea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, WALTER);
  assert.ok(
    nombres.includes("HUERFANA_DE_SU_LINEA"),
    `se normaliza de los DOS lados, en la base — vio: ${nombres.join(", ")}`,
  );
  assert.equal(
    r.conLineaPropia,
    true,
    "y el mapa se lee con la misma normalización: si no, no habría línea propia que reconocer",
  );
});

/**
 * 🔴 `veTodo` GANA PRIMERO, Y EL ORDEN NO ES ESTILO.
 *
 * `usuario1` tiene línea propia **y es admin** en producción (por eso el rol se
 * arma con su nombre). Si esta regla se evaluara antes que el rol, le recortaría
 * la mesa a quien reparte —y no se puede repartir lo que no se ve—, haciendo
 * falso a D4: la frontera es propiedad del ROL. Acotar a un admin es cambiarle
 * el rol, que es operación y no código.
 */
test("🔴 un admin con línea propia sigue viendo la mesa entera", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, WALTER, comoRol("admin", "usuario1"));
  for (const n of ["DE_LUZ_EN_META", "HUERFANA_EN_META", "ARCHIVO_DE_LINEA_RETIRADA"]) {
    assert.ok(nombres.includes(n), `un admin ve ${n} — vio: ${nombres.join(", ")}`);
  }
  assert.equal(r.colaRecortada, undefined, "no hay recorte que anunciar");
  assert.equal(
    r.conLineaPropia,
    undefined,
    "ni una línea propia que explicar: el cartel sale del recorte APLICADO, no de tener una línea",
  );
});

/** El mismo control, con supervisora: el rol de arriba de la escalera no es el único. */
test("y una supervisora con línea propia, igual", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, WALTER, COMO_SUPERVISORA);
  assert.ok(
    nombres.includes("ARCHIVO_DE_LINEA_RETIRADA"),
    `supervisa: ve el archivo también — vio: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 LA CABECERA TIENE QUE DECIR EL MISMO NÚMERO QUE LA LISTA.
 *
 * Es la cicatriz conocida (`docs/auditoria-…` §la frontera recorta filas y no
 * números): a Sindy le servían 3.095 filas bajo un encabezado que decía 5.494,
 * porque el recorte entraba sólo a la consulta de la PÁGINA. Se lee como «la app
 * perdió mis conversaciones» — y de paso el número le cuenta a esa persona
 * cuánto trabajo tiene la otra. Las cuatro cifras salen del MISMO pedido, así
 * que se miran juntas.
 */
test("🔴 total, conteos, desglose y chips cuentan sobre la MISMA cola recortada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { r, nombres } = await cola(db, WALTER);
  assert.equal(
    nombres.length,
    3,
    `su línea, lo asignado y el formulario — vio: ${nombres.join(", ")}`,
  );
  assert.equal(r.total, nombres.length, "el encabezado dice lo que la lista trae");

  const porEtapa = r.conteos ?? {};
  const sumaEtapas = Object.values(porEtapa).reduce((a, b) => a + b, 0);
  assert.equal(sumaEtapas, nombres.length, "las columnas del embudo suman la cola recortada");

  const sumaDesglose = (r.desglose ?? []).reduce((a, f) => a + f.n, 0);
  assert.equal(sumaDesglose, nombres.length, "el desglose del Pipeline mira el mismo universo");
  assert.deepEqual(plegarConteos(r.desglose ?? []), porEtapa, "y los conteos se pliegan de ese desglose");

  for (const [chip, n] of Object.entries(r.conteosFiltro ?? {})) {
    assert.ok(n <= nombres.length, `el chip \`${chip}\` promete ${n} sobre una cola de ${nombres.length}`);
  }
});

/**
 * 🔴 EL CASO QUE ABRÍA LA PUERTA ENTERA — y no lo vio ningún test hasta que un
 * crítico leyó el SQL en vez del enunciado.
 *
 * La rama «la línea es mía» decía **cualquiera de mis líneas**. Con la rama de
 * «línea sin dueña» ya quitada, eso parecía inofensivo… hasta que se piensa qué
 * hace una persona para darle trabajo a Walter en Ventas Meta: **agregarlo a
 * `numero_vendedora` de esa línea**. Es el gesto natural, es lo que hace la
 * pantalla de administración de números, y con la forma ancha le entregaba
 * **Ventas Meta ENTERA** —lo asignado a Luz incluido, y todo lo huérfano— o sea
 * exactamente lo contrario de «de ventas meta sólo los que le asignaron a ellos».
 *
 * El arreglo es que, para quien tiene línea propia, esa rama se acote a sus
 * líneas **propias** (propósito `vendedora` ∧ una sola persona). Lo que le toca
 * de una línea compartida entra por la PRIMERA condición de la frontera
 * (`dueño = yo`) y por ninguna otra.
 *
 * ⚠️ Este test es el único que distingue las dos formas de la rama 2: sin él,
 * volver a la ancha deja los otros ocho en verde.
 */
test("🔴 estar en el mapa de Ventas Meta NO le entrega Ventas Meta entera", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  // El gesto que abre el agujero: se lo suma al mapa de la línea compartida,
  // que es como se le da acceso a una línea en este repo.
  await sembrarLineaDeVendedora(
    db,
    VENTAS_META,
    [...LAS_SIETE_DE_VENTAS_META, WALTER_EN_EL_MAPA],
    "vendedora",
  );

  const { nombres } = await cola(db, WALTER);

  // Lo que SÍ tiene que seguir viendo.
  assert.ok(nombres.includes("ASIGNADA_A_WALTER_EN_META"), "lo asignado a él sigue estando");
  assert.ok(nombres.includes("HUERFANA_DE_SU_LINEA"), "su línea propia sigue entera");

  // Lo que NO puede ver, y es el corazón del pedido.
  assert.ok(
    !nombres.includes("DE_LUZ_EN_META"),
    `lo asignado a Luz no es suyo — vio: ${nombres.join(", ")}`,
  );
  assert.ok(
    !nombres.includes("HUERFANA_EN_META"),
    `lo huérfano de una línea COMPARTIDA no le toca: eso es «Ventas Meta entera» — vio: ${nombres.join(", ")}`,
  );
});

/**
 * ⚠️ EL ESPEJO DEL ANTERIOR: para quien NO tiene línea propia, estar en el mapa
 * de una línea SIGUE dándole esa línea entera. Es el comportamiento de siempre y
 * el de casi todo el equipo — el arreglo de arriba no puede habérselo llevado
 * puesto de paso.
 */
test("⚠️ sin línea propia, estar en el mapa sigue dando la línea entera (como siempre)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);

  const { nombres } = await cola(db, LUZ);
  assert.ok(
    nombres.includes("HUERFANA_EN_META"),
    `Luz comparte Ventas Meta con seis más: no tiene línea propia y ve lo huérfano de la suya — vio: ${nombres.join(", ")}`,
  );
});

/**
 * 🔴 LAS DOS GRAFÍAS DEL MISMO HUMANO SOBRE SU PROPIA LÍNEA.
 *
 * `numero_vendedora` tiene PK `(numero, vendedora_id)`, así que `Walter` y
 * `walter` entran como DOS filas — y eso no es hipotético: es la forma exacta en
 * que este repo ya se lastimó cuatro veces (Cerberus empuja una grafía, el login
 * escribe la otra).
 *
 * Con un conteo crudo esa línea daría `personas = 2`, `tieneLineaPropia`
 * contestaría false y **la regla entera se apagaría sola**: la persona vuelve a
 * arrastrar el archivo de las líneas retiradas y no hay error, ni log, ni nada
 * que ate el síntoma con la causa. Por eso el conteo —en la consulta y en su
 * gemelo SQL— va sobre `DISTINCT lower(btrim(vendedora_id))`.
 */
test("🔴 su línea sigue siendo propia aunque esté cargado con dos grafías", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLaMesa(db);
  // El mismo humano, las dos formas, sobre SU línea.
  await sembrarLineaDeVendedora(db, PROPIA, [WALTER_EN_EL_MAPA, WALTER], "vendedora");

  const { nombres } = await cola(db, WALTER);
  assert.ok(
    !nombres.includes("ARCHIVO_DE_LINEA_RETIRADA"),
    `dos grafías del mismo humano no la vuelven compartida — vio: ${nombres.join(", ")}`,
  );
  assert.ok(nombres.includes("HUERFANA_DE_SU_LINEA"), "y sigue viendo su línea entera");
});
