import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { icarusDePrueba, sembrarIcarus } from "../pruebas/icarusFalso.js";
import { consultarPadron } from "./consultarPadron.js";
import { filtrosSchema } from "./filtros.js";
import { idsDelRecorte, RecorteDemasiadoGrande, RECORTE_MAX } from "./idsDelRecorte.js";

/**
 * REPARTIR TODO LO FILTRADO — los ids del recorte entero, no los de la página.
 *
 * Lo que importa acá es UNA propiedad: **los ids del recorte tienen que ser
 * exactamente los que la lista muestra si se pasaran todas las páginas**. Si
 * divergen, el supervisor mira 17.014, aprieta, y reparte otra cosa.
 */

const filtros = (over: Record<string, unknown> = {}) => filtrosSchema.parse(over);
const sinRecorte = { habilitados: [], soloEstos: null } as const;

describe("los ids de todo el recorte", () => {
  test("trae TODOS los del recorte, no los de la primera página", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // La página trae 2 y el total dice 5: el recorte tiene que dar los 5.
    const pagina = await consultarPadron(sql, { filtros: filtros({ porPagina: 2 }), ...sinRecorte });
    assert.equal(pagina.contactos.length, 2);
    assert.equal(pagina.total, 5);

    const ids = await idsDelRecorte(sql, { filtros: filtros({ porPagina: 2 }), ...sinRecorte });
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  test("🔴 los ids son EXACTAMENTE los que la lista cuenta", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // La propiedad que hace confiable el botón. Se verifica con varios recortes.
    for (const over of [{}, { pais: "Perú" }, { conVenta: "true" }, { pais: "Perú,Guatemala" }]) {
      const f = filtros(over);
      const lista = await consultarPadron(sql, { filtros: f, ...sinRecorte });
      const ids = await idsDelRecorte(sql, { filtros: f, ...sinRecorte });
      assert.equal(ids.length, lista.total, `recorte ${JSON.stringify(over)}`);
    }
  });

  test("los excluidos se sacan", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // Marcar todo y destildar dos: el reparto tiene que respetar el destildado.
    const ids = await idsDelRecorte(sql, { filtros: filtros(), ...sinRecorte }, [2, 4]);
    assert.deepEqual(ids.sort((a, b) => a - b), [1, 3, 5]);
  });

  test("un excluido que no está en el recorte no rompe nada", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const ids = await idsDelRecorte(sql, { filtros: filtros({ pais: "Guatemala" }), ...sinRecorte }, [1, 999]);
    assert.deepEqual(ids, [4]);
  });

  test("🔴 la vendedora no puede repartir el padrón: su recorte es el suyo", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const ids = await idsDelRecorte(sql, { filtros: filtros(), habilitados: [], soloEstos: [4] });
    assert.deepEqual(ids, [4]);

    // Y sin nada habilitado, ninguno — nunca «todos».
    const nada = await idsDelRecorte(sql, { filtros: filtros(), habilitados: [], soloEstos: [] });
    assert.deepEqual(nada, []);
  });

  test("un recorte que no matchea nada devuelve lista vacía, no error", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const ids = await idsDelRecorte(sql, { filtros: filtros({ pais: "Narnia" }), ...sinRecorte });
    assert.deepEqual(ids, []);
  });

  test("🔴 un recorte más grande que el tope FALLA con el número, no se trunca", async (t) => {
    const sql = await icarusDePrueba(t);
    // El tope se inyecta para no sembrar 100.000 filas; lo que se prueba es la
    // regla, no la constante. El `LIMIT tope + 1` es lo que permite distinguir
    // «justo el máximo» de «se pasó»: con LIMIT exacto, un recorte de 30.000 se
    // vería como uno de 25.000 y se repartiría truncado, EN SILENCIO.
    await sql.unsafe(`
      INSERT INTO icarus.contacts (id, name, country)
      SELECT g, 'N' || g, 'Perú' FROM generate_series(1, 11) g;
    `);

    await assert.rejects(
      () => idsDelRecorte(sql, { filtros: filtros(), ...sinRecorte }, [], 10),
      (e: unknown) => {
        assert.ok(e instanceof RecorteDemasiadoGrande);
        assert.equal(e.cuantos, 10);
        assert.match(e.message, /Acotá el filtro/);
        return true;
      },
    );
  });

  test("justo el tope NO falla", async (t) => {
    const sql = await icarusDePrueba(t);
    await sql.unsafe(`
      INSERT INTO icarus.contacts (id, name, country)
      SELECT g, 'N' || g, 'Perú' FROM generate_series(1, 10) g;
    `);

    const ids = await idsDelRecorte(sql, { filtros: filtros(), ...sinRecorte }, [], 10);
    assert.equal(ids.length, 10);
  });

  test("el tope por default cubre el padrón entero (72.923 al 4-ago)", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);
    // Si el tope quedara por debajo del padrón, la pantalla ofrecería «elegir los
    // 72.923» y el server los rechazaría DESPUÉS de confirmar.
    assert.ok(RECORTE_MAX > 72_923, `el tope (${RECORTE_MAX}) tiene que cubrir el padrón`);
    const ids = await idsDelRecorte(sql, { filtros: filtros(), ...sinRecorte });
    assert.equal(ids.length, 5);
  });
});
