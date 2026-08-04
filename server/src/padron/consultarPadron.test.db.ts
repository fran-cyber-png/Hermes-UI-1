import { test, describe, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { guardarAntiProd, URL_ADMIN } from "../pruebas/base.js";
import { consultarPadron } from "./consultarPadron.js";
import { filtrosSchema } from "./filtros.js";

/**
 * EL SQL DEL PADRÓN, CONTRA UNA POSTGRES DE VERDAD (ADR 0008).
 *
 * Ningún test puro puede ver lo que se rompe acá: un fragmento mal compuesto, un
 * `sql.array` que no se serializa, un `count(*) OVER ()` que devuelve el total
 * equivocado cuando la página está a la mitad. Todo eso compila.
 *
 * ── Por qué una base propia y no `baseDePrueba` ──
 * `baseDePrueba` da un `drizzle` sobre el schema de HERMES. Lo que se prueba acá
 * es una consulta contra **icarus**, que es otra base y se habla con el driver
 * crudo. Así que se levanta una base pelada y se le monta un `icarus` mínimo:
 * las columnas que la consulta toca, y ninguna más. Si mañana la consulta pide
 * una columna que icarus no tiene, este test falla — que es exactamente el aviso
 * que hace falta cuando la fuente es de otro equipo.
 */

/** Monta una base efímera con un `icarus` mínimo y devuelve el driver crudo. */
async function icarusDePrueba(t: TestContext) {
  guardarAntiProd(URL_ADMIN);

  const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
  const nombre = `t_padron_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await admin.unsafe(`CREATE DATABASE "${nombre}"`);

  const sql = postgres(URL_ADMIN.replace(/\/[^/]+$/, `/${nombre}`), { max: 2, onnotice: () => {} });

  t.after(async () => {
    await sql.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.end({ timeout: 5 });
  });

  await sql.unsafe(`
    CREATE SCHEMA icarus;
    CREATE TABLE icarus.contacts (
      id bigint PRIMARY KEY,
      name text, email text, phone text, dni varchar,
      country text, stage text, buyer_tier text,
      total_usd_spent numeric, n_purchases integer,
      course text, last_course text, source text,
      created_at timestamptz
    );
    CREATE TABLE icarus.sales (id bigint PRIMARY KEY, contact_id bigint);
  `);

  return sql;
}

/** El corpus: chico, pero con la forma real de los defectos medidos en producción. */
async function sembrar(sql: postgres.Sql) {
  await sql.unsafe(`
    INSERT INTO icarus.contacts
      (id, name, email, phone, dni, country, stage, buyer_tier, total_usd_spent, n_purchases, course, last_course, source, created_at)
    VALUES
      -- Dice 3 compras y NO tiene ninguna venta: el 55% del padrón, medido.
      (1,'Ana Mentira','ana@x.com','51986394450','111','PE','sold','vip',900,3,'Curso A','Curso A','anuncio','2026-01-10'),
      -- Compradora de verdad: tiene fila en sales.
      (2,'Beto Real','beto@x.com','51999888777','222','PE','sold','single',450,1,'Curso B','Curso B','formulario','2026-03-15'),
      -- Sin teléfono usable.
      (3,'Cami SinTel','cami@x.com','12','333','MX','contacted','prospect',NULL,0,'Curso A',NULL,'anuncio','2026-05-20'),
      -- Guatemalteca: local de 8 dígitos, el caso que rompía el match por sufijo.
      (4,'Dora Guate','dora@x.com','50255123456','444','GT','interested','prospect',NULL,0,NULL,'Curso C','organico','2026-07-01'),
      -- Sin fecha: tiene que quedar AL FINAL en los dos órdenes, no arriba.
      (5,'Eva SinFecha','eva@x.com','51911222333','555','PE','contacted',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    INSERT INTO icarus.sales (id, contact_id) VALUES (10, 2);
  `);
}

const filtros = (over: Record<string, unknown> = {}) => filtrosSchema.parse(over);

describe("consultar el padrón", () => {
  test("sin filtros trae todo, con el total del recorte", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), habilitados: [], soloEstos: null });
    assert.equal(r.total, 5);
    assert.equal(r.contactos.length, 5);
  });

  test("🔴 «compró» sale de `sales`, NO del contador que miente", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ conVenta: "true" }),
      habilitados: [],
      soloEstos: null,
    });
    // Ana dice 3 compras y no tiene ninguna venta. Si el filtro mirara
    // `n_purchases`, acá habría dos y el lote iría con un cliente inventado.
    assert.deepEqual(
      r.contactos.map((c) => c.nombre),
      ["Beto Real"],
    );
    assert.equal(r.total, 1);
  });

  test("`conVenta` viaja en cada fila, aunque no se filtre por él", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), habilitados: [], soloEstos: null });
    const ana = r.contactos.find((c) => c.id === 1)!;
    assert.equal(ana.compras, 3, "la fuente dice 3");
    assert.equal(ana.conVenta, false, "y ninguna venta lo respalda — las dos cosas se muestran");
  });

  test("el filtro de teléfono usable descarta los que no se pueden contactar", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ conTelefono: "true" }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(r.total, 4);
    assert.ok(!r.contactos.some((c) => c.nombre === "Cami SinTel"));
    // El guatemalteco de 8 dígitos locales SÍ entra: el largo se mide sobre el
    // E.164 completo, no sobre un sufijo peruano.
    assert.ok(r.contactos.some((c) => c.nombre === "Dora Guate"));
  });

  test("«sin habilitar» saca los que ya tienen dueña", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ sinHabilitar: "true" }),
      habilitados: [1, 2, 3],
      soloEstos: null,
    });
    assert.deepEqual(r.contactos.map((c) => c.id).sort(), [4, 5]);
    assert.equal(r.total, 2, "el total es el del pozo que queda, no el del padrón");
  });

  test("🔴 la vendedora ve SOLO lo suyo, aunque el filtro pida todo", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros(),
      habilitados: [],
      soloEstos: [2, 4],
    });
    assert.deepEqual(r.contactos.map((c) => c.id).sort(), [2, 4]);
    assert.equal(r.total, 2);
  });

  test("🔴 sin nada habilitado NO se ve el padrón: cero filas, no todas", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    // El defecto que abriría la frontera entera: una lista vacía tratada como
    // «sin recorte». Acá tiene que dar cero, y `null` (supervisor) tiene que dar todo.
    const vacia = await consultarPadron(sql, { filtros: filtros(), habilitados: [], soloEstos: [] });
    assert.equal(vacia.total, 0);
    assert.equal(vacia.contactos.length, 0);

    const supervisor = await consultarPadron(sql, {
      filtros: filtros(),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(supervisor.total, 5);
  });

  test("el recorte de la vendedora se combina con sus filtros", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ conVenta: "true" }),
      habilitados: [],
      soloEstos: [1, 3],
    });
    // Ninguno de los suyos compró de verdad: cero, no «los que compraron del padrón».
    assert.equal(r.total, 0);
  });

  test("la búsqueda mira nombre, correo, teléfono y DNI", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    for (const [q, esperado] of [
      ["beto", 2],
      ["BETO", 2], // insensible a mayúsculas
      ["999888", 2], // teléfono parcial
      ["444", 4], // DNI
      ["dora@x.com", 4],
    ] as const) {
      const r = await consultarPadron(sql, {
        filtros: filtros({ q }),
        habilitados: [],
        soloEstos: null,
      });
      assert.equal(r.contactos[0]?.id, esperado, `buscando «${q}»`);
    }
  });

  test("el curso se busca en las dos columnas (con el que entró y en el que anda)", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ curso: "Curso C" }),
      habilitados: [],
      soloEstos: null,
    });
    // Dora tiene `course` NULL y `last_course` = 'Curso C'.
    assert.deepEqual(r.contactos.map((c) => c.id), [4]);
    assert.equal(r.contactos[0].curso, "Curso C", "se muestra el último, que es en qué anda hoy");
  });

  test("los que no tienen fecha quedan al final, no arriba", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const recientes = await consultarPadron(sql, {
      filtros: filtros({ orden: "recientes" }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(recientes.contactos.at(-1)?.nombre, "Eva SinFecha");

    const antiguos = await consultarPadron(sql, {
      filtros: filtros({ orden: "antiguos" }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(antiguos.contactos.at(-1)?.nombre, "Eva SinFecha", "NULLS LAST en los dos sentidos");
    assert.equal(antiguos.contactos[0]?.nombre, "Ana Mentira");
  });

  test("🔴 el total es el del RECORTE, no el de la página", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const p1 = await consultarPadron(sql, {
      filtros: filtros({ porPagina: 2, pagina: 1 }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(p1.contactos.length, 2);
    assert.equal(p1.total, 5, "si esto dijera 2, el supervisor repartiría creyendo que hay 2");

    const p3 = await consultarPadron(sql, {
      filtros: filtros({ porPagina: 2, pagina: 3 }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(p3.contactos.length, 1, "la última página, incompleta");
    assert.equal(p3.total, 5);
  });

  test("una página más allá del final devuelve total 0 y no rompe", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ porPagina: 2, pagina: 99 }),
      habilitados: [],
      soloEstos: null,
    });
    assert.deepEqual(r.contactos, []);
    assert.equal(r.total, 0);
  });

  test("una etapa que no existe devuelve cero filas, no un error", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ etapa: "etapa_del_futuro" }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(r.total, 0);
  });

  test("una comilla en la búsqueda no rompe la consulta", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrar(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ q: "O'Brien' OR '1'='1" }),
      habilitados: [],
      soloEstos: null,
    });
    assert.equal(r.total, 0, "parametrizado: no matchea nada y no ejecuta nada");
  });
});
