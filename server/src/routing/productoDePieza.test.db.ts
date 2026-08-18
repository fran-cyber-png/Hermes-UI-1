import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { aliasesActivos } from "../cursos/repositorio.js";
import { resolverFamilia } from "../cursos/alias.js";
import { corregirProductoDePieza, textoDeLaPieza } from "./productoDePieza.js";
import { cursosDeFormulario } from "./repositorio.js";

/**
 * 🔴 QUE LA CORRECCIÓN SE APLIQUE DE VERDAD, no que el `PUT` conteste `ok`.
 *
 * Es la lección de ADR 0042 (`estado.md` afirmaba «cola unificada 4 canales» y
 * era cierto del código y falso de la realidad) y del defecto que la auditoría
 * del 12-ago encontró en este mismo frente: se cableaba con una expresión del
 * curso y se matcheaba con otra, así que la pantalla mostraba la pieza conectada
 * **y la regla no se aplicaba nunca**. Por eso cada caso de acá vuelve a
 * preguntar por el camino REAL —`aliasesActivos` + `resolverFamilia`, que es lo
 * que corre en la cola y en el Dashboard— en vez de mirar la fila que escribió.
 */

/** El falso positivo real: lo agarra «consultoria politica» y es de ChatGPT Pro. */
const CURSO_MAL = "Programa Premium ChatGPT Pro para consultoría política 4×4";
const CURSO_BIEN = "Diploma Internacional del Consultor Político";

type Db = Awaited<ReturnType<typeof baseDePrueba>>;

/** El diccionario mínimo que reproduce el choque medido en producción. */
async function sembrarAliases(db: Db) {
  await db.execute(sql`
    INSERT INTO alias_curso (alias, familia, nombre_curso, activo) VALUES
      ('consultoria politica', 'DIPCPOL', 'Consultor Político', true),
      ('consultor politico',   'DIPCPOL', 'Consultor Político', true),
      ('chatgpt pro',          'EPCOGPT', 'ChatGPT Pro 4x4',    true)
  `);
}

async function sembrarLead(db: Db, curso: string, telefono = "51993166578") {
  const [ev] = await db.execute<{ id: number }>(sql`
    INSERT INTO events (source, external_id, occurred_at, payload)
    VALUES ('icarus_landing', ${`icarus:${telefono}:${curso}`}, now(), '{}'::jsonb)
    RETURNING id
  `);
  await db.execute(sql`
    INSERT INTO leads (event_id, lead_id, platform, phone, full_name, campaign_name, form_name, created_time, status)
    VALUES (${ev!.id}, ${`icarus:${telefono}:${curso}`}, 'web', ${telefono}, 'Quien Sea',
            ${curso}, 'icarus:landing', now(), 'nuevo')
  `);
}

/** Cómo resuelve la pieza HOY, por el camino real que usan la cola y el Dashboard. */
async function productoDe(db: Db, texto: string) {
  const r = resolverFamilia(await aliasesActivos(db as never), texto);
  return { familia: r?.familia ?? null, origen: r?.origen ?? null };
}

const catalogoDe = (...familias: string[]) => async () =>
  familias.map((f, i) => ({
    id: String(i + 1),
    sku: `${f}00${i + 1}`,
    nombre: `Producto ${f}`,
    precioNormal: 100,
    precioPromocion: 90,
    moneda: "PEN",
  }));

test("🔴 corregir un formulario lo saca del producto que lo enganchaba mal", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  assert.deepEqual(
    await productoDe(db, CURSO_MAL),
    { familia: "DIPCPOL", origen: "alias" },
    "arranca mal: lo agarra «consultoria politica»",
  );

  const r = await corregirProductoDePieza(db, {
    tipo: "curso",
    clave: CURSO_MAL,
    familia: "EPCOGPT",
    quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });
  assert.equal(r.ok, true);

  assert.deepEqual(
    await productoDe(db, CURSO_MAL),
    { familia: "EPCOGPT", origen: "manual" },
    "y ahora resuelve al producto correcto POR EL CAMINO REAL",
  );
});

test("🔴 y NO se lleva puestas a las otras piezas que usan ese mismo alias", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);
  await sembrarLead(db, CURSO_BIEN, "51922572001");

  const antes = await productoDe(db, CURSO_BIEN);
  await corregirProductoDePieza(db, {
    tipo: "curso",
    clave: CURSO_MAL,
    familia: "EPCOGPT",
    quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });

  assert.deepEqual(await productoDe(db, CURSO_BIEN), antes, "el Consultor Político sigue igual");
  assert.equal(antes.familia, "DIPCPOL");
});

test("deshacer devuelve la pieza a su resolución automática", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL, familia: "EPCOGPT", quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });
  assert.equal((await productoDe(db, CURSO_MAL)).origen, "manual");

  const r = await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL, familia: null, quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(await productoDe(db, CURSO_MAL), { familia: "DIPCPOL", origen: "alias" });
});

test("🔴 corregir DOS veces la misma pieza no deja dos filas peleando", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  for (const familia of ["EPCOGPT", "DIPCPOL", "EPCOGPT"]) {
    await corregirProductoDePieza(db, {
      tipo: "curso", clave: CURSO_MAL, familia, quien: "usuario1",
      catalogo: catalogoDe("EPCOGPT", "DIPCPOL"),
    });
  }

  const [fila] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM alias_curso WHERE alias = ${CURSO_MAL}
  `);
  assert.equal(Number(fila!.n), 1, "una sola fila describe a esta pieza");
  assert.equal((await productoDe(db, CURSO_MAL)).familia, "EPCOGPT", "gana la última");
});

test("y volver a corregir después de deshacer REENCIENDE la misma fila", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);
  const opciones = { tipo: "curso" as const, clave: CURSO_MAL, quien: "usuario1", catalogo: catalogoDe("EPCOGPT") };

  await corregirProductoDePieza(db, { ...opciones, familia: "EPCOGPT" });
  await corregirProductoDePieza(db, { ...opciones, familia: null });
  const r = await corregirProductoDePieza(db, { ...opciones, familia: "EPCOGPT" });

  assert.equal(r.ok, true, "sin esto, el INSERT chocaría con el unique del alias");
  assert.equal((await productoDe(db, CURSO_MAL)).origen, "manual");
});

test("una familia que no existe se rechaza ENUMERANDO, nunca se escribe", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  const r = await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL, familia: "NOEXISTE", quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.codigo, "familia_desconocida");
  assert.ok(r.ok === false && r.familias?.includes("DIPCPOL"), "dice a cuáles sí");
  assert.equal((await productoDe(db, CURSO_MAL)).familia, "DIPCPOL", "no tocó nada");
});

test("🔴 «no existe» y «no se pudo preguntar» NO son la misma respuesta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  const r = await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL,
    // ⚠️ Una familia que el diccionario NO tiene: `EPCOGPT` no sirve para este
    // caso porque ya está sembrada, y ahí la corrección procede sin preguntarle
    // nada a Cerberus (es el test de abajo). Ésta es real y Hermes no la conoce.
    familia: "DIPECOC",
    quien: "usuario1",
    catalogo: async () => { throw new Error("cerberus caído"); },
  });
  assert.equal(r.ok, false);
  assert.equal(
    r.ok === false && r.codigo,
    "catalogo_caido",
    "decir «esa familia no existe» mandaría a buscar el problema donde no está",
  );
});

test("una familia YA conocida se puede elegir aunque Cerberus no conteste", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  const r = await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL, familia: "EPCOGPT", quien: "usuario1",
    catalogo: async () => { throw new Error("cerberus caído"); },
  });
  // «chatgpt pro» ya está en el diccionario, así que EPCOGPT es conocida.
  assert.equal(r.ok, true, "degrada a lo que Hermes ya sabe nombrar, no se bloquea");
});

test("una pieza que no existe es 404, no una fila inventada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);

  const r = await corregirProductoDePieza(db, {
    tipo: "curso", clave: "Un curso que nadie mandó nunca", familia: "EPCOGPT",
    quien: "usuario1", catalogo: catalogoDe("EPCOGPT"),
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.codigo, "pieza_desconocida");

  const [fila] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM alias_curso`);
  assert.equal(Number(fila!.n), 3, "no escribió un alias para una pieza que nadie ve");
});

test("🔴 el texto lo resuelve el SERVER: la clave de una campaña NO es su nombre", async (t) => {
  const db = await baseDePrueba(t);
  await db.execute(sql`
    INSERT INTO campana_meta (campana_id, nombre, estado, numeros)
    VALUES ('120111', '[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR', 'ACTIVE', ARRAY['51984429504'])
  `);
  assert.equal(await textoDeLaPieza(db, "campana", "120111"), "[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR");
  assert.equal(await textoDeLaPieza(db, "campana", "no-existe"), null);
});

test("🔴 la corrección se VE en la lista que dibuja la pantalla", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);

  const antes = (await cursosDeFormulario(db)).find((c) => c.curso === CURSO_MAL);
  assert.equal(antes?.familia, "DIPCPOL");
  assert.equal(antes?.origenFamilia, "alias");
  assert.equal(antes?.aliasFamilia, "consultoria politica", "y dice CUÁL lo enganchó");

  await corregirProductoDePieza(db, {
    tipo: "curso", clave: CURSO_MAL, familia: "EPCOGPT", quien: "usuario1",
    catalogo: catalogoDe("EPCOGPT"),
  });

  const despues = (await cursosDeFormulario(db)).find((c) => c.curso === CURSO_MAL);
  assert.equal(despues?.familia, "EPCOGPT");
  assert.equal(despues?.origenFamilia, "manual");
});

test("queda escrito QUIÉN corrigió, y sobrevive a deshacer", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliases(db);
  await sembrarLead(db, CURSO_MAL);
  const opciones = { tipo: "curso" as const, clave: CURSO_MAL, quien: "usuario1", catalogo: catalogoDe("EPCOGPT") };

  await corregirProductoDePieza(db, { ...opciones, familia: "EPCOGPT" });
  await corregirProductoDePieza(db, { ...opciones, familia: null });

  const [fila] = await db.execute<{ corregido_por: string | null; activo: boolean }>(sql`
    SELECT corregido_por, activo FROM alias_curso WHERE alias = ${CURSO_MAL}
  `);
  assert.equal(fila!.corregido_por, "usuario1");
  assert.equal(fila!.activo, false, "deshacer desactiva; el rastro de quién había decidido queda");
});
