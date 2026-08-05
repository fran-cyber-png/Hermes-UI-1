import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { icarusDePrueba, sembrarCompradorSinCurso, sembrarIcarus } from "../pruebas/icarusFalso.js";
import { consultarPadron } from "./consultarPadron.js";
import { consultarFacetas } from "./facetas.js";
import { filtrosSchema } from "./filtros.js";

/**
 * LAS FACETAS Y EL MULTIVALOR, contra Postgres de verdad.
 *
 * Lo que se verifica no es «devuelve una lista»: es que **el número que la
 * pantalla ofrece sea el que el filtro después entrega**. Una faceta que diga
 * «México · 11.646» y al tildarla traiga otra cosa es peor que no tener facetas,
 * porque el supervisor reparte mirando ese número.
 */

const filtros = (over: Record<string, unknown> = {}) => filtrosSchema.parse(over);
const sinRecorte = { habilitados: [], soloEstos: null } as const;

/** El valor de una opción, o 0 si no está ofrecida. */
function cuenta(ops: { valor: string; contactos: number }[], valor: string): number {
  return ops.find((o) => o.valor === valor)?.contactos ?? 0;
}

describe("multivalor: OR adentro, AND entre dimensiones", () => {
  test("dos países traen los dos, no la intersección vacía", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ pais: "Perú,Guatemala" }),
      ...sinRecorte,
    });
    // Con un valor por dimensión esto no se podía pedir: había que mirar los dos
    // recortes por separado y el supervisor perdía el total.
    assert.deepEqual(r.contactos.map((c) => c.id).sort(), [1, 2, 4, 5]);
    assert.equal(r.total, 4);
  });

  test("el array también llega repetido en la query string (`pais=a&pais=b`)", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ pais: ["México", "Guatemala"] }),
      ...sinRecorte,
    });
    assert.deepEqual(r.contactos.map((c) => c.id).sort(), [3, 4]);
  });

  test("dos dimensiones se cruzan con AND, no se suman", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, {
      filtros: filtros({ pais: "Perú,Guatemala", etapa: "interested" }),
      ...sinRecorte,
    });
    // «(peruanos o guatemaltecos) Y interesados» = solo Dora. Si fuera OR entre
    // dimensiones traería 4 y el lote se iría a gente que no calificaba.
    assert.deepEqual(r.contactos.map((c) => c.id), [4]);
  });

  test("el curso mira las DOS columnas: con el que entró y en el que anda", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // Dora entró con «Curso A» y hoy anda en «Curso C»: aparece en los dos.
    const porA = await consultarPadron(sql, { filtros: filtros({ curso: "Curso A" }), ...sinRecorte });
    assert.ok(porA.contactos.some((c) => c.id === 4), "por el curso con el que entró");

    const porC = await consultarPadron(sql, { filtros: filtros({ curso: "Curso C" }), ...sinRecorte });
    assert.deepEqual(porC.contactos.map((c) => c.id), [4], "y por el que tiene hoy");
  });

  test("una lista vacía es filtro AUSENTE, no «ninguno»", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // `pais=` (o `pais=,,`) tiene que traer TODO. Tratarlo como lista vacía daría
    // cero filas: «ningún país» en vez de «cualquier país».
    const r = await consultarPadron(sql, { filtros: filtros({ pais: ",, " }), ...sinRecorte });
    assert.equal(r.total, 5);
  });

  test("un valor repetido no duplica filas", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, { filtros: filtros({ pais: "Perú,Perú" }), ...sinRecorte });
    assert.equal(r.total, 3);
  });
});

describe("las facetas", () => {
  test("cuentan cada valor, ordenados por volumen", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros(), ...sinRecorte });
    assert.deepEqual(f.pais[0], { valor: "Perú", contactos: 3 }, "el más numeroso primero");
    assert.equal(cuenta(f.pais, "México"), 1);
    assert.equal(cuenta(f.etapa, "sold"), 2);
    assert.equal(cuenta(f.nivel, "vip"), 1);
  });

  test("🔴 el conteo de la faceta ES el total que devuelve el filtro", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    // La propiedad que hace confiable la pantalla. Si divergen, el supervisor
    // reparte mirando un número que no es el del lote.
    const f = await consultarFacetas(sql, { filtros: filtros(), ...sinRecorte });
    for (const op of f.pais) {
      const r = await consultarPadron(sql, { filtros: filtros({ pais: op.valor }), ...sinRecorte });
      assert.equal(r.total, op.contactos, `país «${op.valor}»`);
    }
  });

  test("🔴 la faceta de una dimensión NO se filtra a sí misma", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros({ pais: "Perú" }), ...sinRecorte });
    // Con Perú tildado, México y Guatemala siguen ofrecidos con su número: si se
    // filtrara a sí misma, la lista se reduciría a Perú y no habría forma de
    // AGREGAR otro país sin antes borrar el filtro.
    assert.equal(cuenta(f.pais, "Perú"), 3);
    assert.equal(cuenta(f.pais, "México"), 1);
    assert.equal(cuenta(f.pais, "Guatemala"), 1);
  });

  test("…pero las OTRAS dimensiones sí se recortan", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros({ pais: "Guatemala" }), ...sinRecorte });
    // Con Guatemala tildado solo queda Dora: `interested`, y ninguna etapa más.
    assert.deepEqual(f.etapa, [{ valor: "interested", contactos: 1 }]);
  });

  test("los booleanos recortan las facetas", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros({ conVenta: "true" }), ...sinRecorte });
    // Solo Beto tiene venta real: la única opción de país es Perú, con 1.
    assert.deepEqual(f.pais, [{ valor: "Perú", contactos: 1 }]);
  });

  test("los vacíos y los nulos no se ofrecen como opción", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros(), ...sinRecorte });
    // Eva no tiene nivel ni curso: «filtrar por nivel en blanco» no es algo que
    // alguien quiera pedir, y ocuparía un renglón de la lista.
    assert.ok(!f.nivel.some((o) => o.valor === "" || o.valor === null));
    // vip 1 + single 1 + prospect 2 = 4. Eva, la quinta, no tiene nivel y no suma.
    assert.equal(f.nivel.reduce((s, o) => s + o.contactos, 0), 4, "los 4 que sí tienen nivel");
  });

  test("el curso se cuenta por las dos columnas, sin duplicar la misma fila", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros(), ...sinRecorte });
    // Ana y Cami entraron con «Curso A»; Dora también, y además tiene «Curso C».
    assert.equal(cuenta(f.curso, "Curso A"), 3);
    assert.equal(cuenta(f.curso, "Curso C"), 1);
    // Ana tiene 'Curso A' en las DOS columnas y no puede contarse dos veces.
    const porA = await consultarPadron(sql, { filtros: filtros({ curso: "Curso A" }), ...sinRecorte });
    assert.equal(porA.total, 3, "el filtro y la faceta dicen lo mismo");
  });

  test("🔴 la vendedora no ve facetas del padrón entero, solo de lo suyo", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, {
      filtros: filtros(),
      habilitados: [],
      soloEstos: [4],
    });
    // Ofrecerle «Perú · 3» sobre una lista donde tiene un guatemalteco sería
    // filtrar la frontera por la puerta de atrás.
    assert.deepEqual(f.pais, [{ valor: "Guatemala", contactos: 1 }]);
  });

  test("sin nada habilitado, las facetas están vacías (no son las de todos)", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const f = await consultarFacetas(sql, { filtros: filtros(), habilitados: [], soloEstos: [] });
    assert.deepEqual(f, { pais: [], curso: [], etapa: [], nivel: [], fuente: [] });
  });
});

describe("qué compró — el dato que la columna «curso» no tenía", () => {
  test("el producto sale de la venta, no del curso declarado", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    const beto = r.contactos.find((c) => c.id === 2)!;
    assert.equal(beto.curso, "Curso B", "lo que declaró");
    assert.equal(beto.comprado, "Curso B (comprado)", "lo que pagó");
  });

  test("🔴 gana el ítem principal, no el add-on más barato", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    // La venta de Beto trae el curso (450) y un «Certificado» (30). En producción
    // «Certificado» y «Certificado con Portadiploma» son el #2 y #3 del catálogo
    // por volumen: mostrarlos en vez del curso diría bastante menos.
    assert.notEqual(r.contactos.find((c) => c.id === 2)!.comprado, "Certificado");
  });

  test("🔴 quien compró por Cerberus tiene producto y NO tiene curso declarado", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);
    await sembrarCompradorSinCurso(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    const fabio = r.contactos.find((c) => c.id === 6)!;
    // Es exactamente la fila que en pantalla se ve «sin curso pero Sí compró», y
    // es correcta: `course` lo llena la landing, y él nunca la llenó.
    assert.equal(fabio.curso, null);
    assert.equal(fabio.conVenta, true);
    assert.equal(fabio.comprado, "Diplomado en Gestión Pública");
    // Y su contador de compras dice 0 aunque la venta existe: por eso `conVenta`
    // manda y `compras` nunca se dibuja solo.
    assert.equal(fabio.compras, 0);
  });

  test("quien no compró no tiene producto, y eso no es un hueco", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    const ana = r.contactos.find((c) => c.id === 1)!;
    assert.equal(ana.comprado, null);
    assert.equal(ana.conVenta, false);
    assert.equal(ana.compras, 3, "el contador afirma 3 y ninguna venta lo respalda");
  });

  test("varias ventas: se muestra la MÁS RECIENTE", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);
    await sql.unsafe(`
      INSERT INTO icarus.products (id, name) VALUES (300, 'Curso Nuevo');
      INSERT INTO icarus.sales (id, contact_id, sale_date) VALUES (30, 2, '2026-07-01');
      INSERT INTO icarus.sale_items (id, sale_id, product_id, total_price) VALUES (3000, 30, 300, 200);
    `);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    // La de julio es posterior a la de marzo, aunque sea más barata: lo que
    // importa para hablarle hoy es lo último que le vendimos.
    assert.equal(r.contactos.find((c) => c.id === 2)!.comprado, "Curso Nuevo");
  });

  test("🔴 varias ventas NO duplican la fila ni inflan el total", async (t) => {
    const sql = await icarusDePrueba(t);
    await sembrarIcarus(sql);
    await sql.unsafe(`
      INSERT INTO icarus.products (id, name) VALUES (300, 'Curso Nuevo');
      INSERT INTO icarus.sales (id, contact_id, sale_date) VALUES (30, 2, '2026-07-01');
      INSERT INTO icarus.sale_items (id, sale_id, product_id, total_price) VALUES (3000, 30, 300, 200);
    `);

    const r = await consultarPadron(sql, { filtros: filtros(), ...sinRecorte });
    // Con un JOIN plano en vez de LATERAL, Beto aparecería tres veces (dos ventas,
    // tres ítems) y el total diría 8 en vez de 5 — y el supervisor repartiría mal.
    assert.equal(r.total, 5);
    assert.equal(r.contactos.filter((c) => c.id === 2).length, 1);
  });
});
