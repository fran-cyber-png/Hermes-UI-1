import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarGestion, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola, type ColumnaPedida, type ColumnaServida } from "./consultarCola.js";

/**
 * ══ EL CANDADO DEL TABLERO EN UN SOLO PEDIDO ═════════════════════════════════
 *
 * 🔴 **LO QUE ESTE ARCHIVO AFIRMA ES UNA IGUALDAD, NO UN COMPORTAMIENTO.** El
 * Pipeline dejó de pedir cinco colas para pedir una con cinco columnas, y todo
 * el ahorro sale de compartir la tabla temporal `todo`. Lo que hay que probar,
 * entonces, no es que el tablero «funcione»: es que devuelva **exactamente** lo
 * mismo que las cinco llamadas sueltas que reemplaza — fila por fila, en el
 * mismo orden, con el mismo total.
 *
 * Sin esta comparación, las dos formas de armar el total (el desglose para la
 * columna sin recorte, un `count(*) FILTER` para la recortada) son dos
 * definiciones esperando a divergir, y la que se ve en pantalla es un número:
 * nadie mira una columna y nota que le faltan tres.
 */

const NUMERO = "51999999999";
const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);
const claveDe = (personaId: string) => `conv:whatsapp:${personaId}:${NUMERO}`;

const COLUMNAS: ColumnaPedida[] = [
  { etapa: "interesado" },
  { etapa: "sin_respuesta" },
  { etapa: "contactado" },
  { etapa: "cotizado" },
  { etapa: "cierre" },
];

/**
 * Una tarjeta de cada peldaño, más las que los recortes tienen que poder
 * separar. `p-cot-2` es la que se calló con el precio: habló, recibió el número
 * y no volvió a escribir.
 */
async function sembrarElTablero(db: Parameters<typeof consultarCola>[0]) {
  // Te esperan: escribió y nadie contestó.
  await sembrarMensaje(db, { personaId: "p-int-1", occurredAt: hace(3) });
  await sembrarComentario(db, { personaId: "c-int-2", occurredAt: hace(4) });

  // Nunca contestaron: le escribimos y jamás dijo una palabra.
  await sembrarMensaje(db, { personaId: "p-sin-1", direccion: "saliente", occurredAt: hace(20) });

  // Contestaron.
  await sembrarMensaje(db, { personaId: "p-con-1", occurredAt: hace(6) });
  await sembrarMensaje(db, { personaId: "p-con-1", direccion: "saliente", occurredAt: hace(5) });
  await sembrarMensaje(db, { personaId: "p-con-2", occurredAt: hace(30) });
  await sembrarMensaje(db, { personaId: "p-con-2", direccion: "saliente", occurredAt: hace(29) });

  // Saben el precio: habló y le mandamos un número. Ésta SIGUIÓ conversando
  // después del número — es el control de «se callaron con el precio».
  await sembrarMensaje(db, { personaId: "p-cot-1", occurredAt: hace(10) });
  await sembrarMensaje(db, {
    personaId: "p-cot-1",
    direccion: "saliente",
    texto: "La inversión es S/ 350 e incluye el certificado",
    occurredAt: hace(9),
  });
  await sembrarMensaje(db, { personaId: "p-cot-1", texto: "¿y cuándo empieza?", occurredAt: hace(8) });
  // La que se calló con el precio: el saliente con el número es lo ÚLTIMO que pasó.
  await sembrarMensaje(db, { personaId: "p-cot-2", occurredAt: hace(200) });
  await sembrarMensaje(db, {
    personaId: "p-cot-2",
    direccion: "saliente",
    texto: "Cuesta S/ 350, se puede pagar en cuotas",
    occurredAt: hace(190),
  });

  // Compraron. Va DECLARADO y no derivado de una venta: para lo que este archivo
  // afirma —que el tablero y las cinco llamadas sueltas coinciden— lo que importa
  // es que la columna tenga filas, y la derivación desde `conversiones_wa` ya
  // tiene su propio candado en `etapaEfectiva.paridad.test.db.ts`.
  await sembrarMensaje(db, { personaId: "p-cie-1", occurredAt: hace(48) });
  await sembrarMensaje(db, { personaId: "p-cie-1", direccion: "saliente", occurredAt: hace(47) });
  await sembrarGestion(db, { clave: claveDe("p-cie-1"), etapa: "cierre" });

  // Y una declarada a mano, para que el embudo no sea sólo derivado.
  await sembrarMensaje(db, { personaId: "p-con-3", occurredAt: hace(12) });
  await sembrarGestion(db, { clave: claveDe("p-con-3"), etapa: "contactado" });
}

/** Lo que se compara de una fila: la identidad y la etapa donde cayó. */
type Fila = { clave: string; persona_id: string | null; etapa_efectiva: string };
const identidad = (filas: unknown[]) =>
  (filas as Fila[]).map((f) => `${f.clave}|${f.etapa_efectiva}`);

describe("el tablero en un pedido devuelve lo mismo que N pedidos", () => {
  test("cinco columnas sin recorte: filas, orden y total, columna por columna", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarElTablero(db);

    const tablero = await consultarCola(db, { columnas: COLUMNAS, limit: 30 });
    assert.ok(tablero.columnas, "el modo tablero tiene que servir `columnas`");

    for (const col of COLUMNAS) {
      const suelta = await consultarCola(db, { etapa: col.etapa, limit: 30 });
      const servida: ColumnaServida | undefined = tablero.columnas[col.etapa];
      assert.ok(servida, `falta la columna ${col.etapa}`);
      assert.deepEqual(
        identidad(servida.conversaciones),
        identidad(suelta.conversaciones),
        `las filas de ${col.etapa} no coinciden con las de ?etapa=${col.etapa}`,
      );
      assert.equal(servida.total, suelta.total, `el total de ${col.etapa} no coincide`);
      assert.equal(servida.hayMas, suelta.hayMas, `hayMas de ${col.etapa} no coincide`);
    }
  });

  test("el desglose y los conteos son los mismos que los de una llamada suelta", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarElTablero(db);

    const tablero = await consultarCola(db, { columnas: COLUMNAS, limit: 30 });
    const suelta = await consultarCola(db, { etapa: "cotizado", limit: 30 });

    assert.deepEqual(tablero.conteos, suelta.conteos);
    assert.deepEqual(tablero.desglose, suelta.desglose);
  });

  /**
   * 🔴 EL CAMINO DE LOS DOS TOTALES. Una columna sin recorte saca su total del
   * desglose (gratis); una recortada paga un `count(*) FILTER`. Son dos
   * expresiones distintas del mismo conjunto, y es exactamente el par que puede
   * divergir sin síntoma.
   */
  test("con recorte por columna: cada una cuenta LO SUYO", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarElTablero(db);

    const conRecorte: ColumnaPedida[] = [
      { etapa: "interesado" },
      { etapa: "cotizado", seCallo: true },
      { etapa: "contactado", precio: true },
      { etapa: "cierre", ventana: true },
    ];

    const tablero = await consultarCola(db, { columnas: conRecorte, limit: 30 });
    assert.ok(tablero.columnas);

    for (const col of conRecorte) {
      const suelta = await consultarCola(db, { ...col, limit: 30 });
      const servida: ColumnaServida = tablero.columnas[col.etapa]!;
      assert.deepEqual(
        identidad(servida.conversaciones),
        identidad(suelta.conversaciones),
        `${col.etapa} recortada no devuelve las mismas filas`,
      );
      assert.equal(servida.total, suelta.total, `${col.etapa} recortada no cuenta lo mismo`);
    }

    /**
     * Y EL RECORTE DE VERDAD RECORTA. Sin esta afirmación el test pasaría con los
     * cuatro recortes rotos: dos consultas que devuelven lo mismo *porque ninguna
     * filtra* son igualitas, y la paridad de arriba no puede notar la diferencia.
     *
     * Las dos cotizadas recibieron el precio; sólo `p-cot-2` se calló después.
     */
    assert.equal(tablero.columnas.cotizado!.total, 1, "«se callaron con el precio» deja una de las dos");
    assert.equal(tablero.conteos?.cotizado, 2, "el conteo de la columna es el de SIN recortar");
  });

  test("una columna vacía viene igual: ausente se lee como «el server no la sabe servir»", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: "p-solo", occurredAt: hace(2) });

    const tablero = await consultarCola(db, { columnas: COLUMNAS, limit: 30 });
    assert.deepEqual(Object.keys(tablero.columnas ?? {}).sort(), COLUMNAS.map((c) => c.etapa).sort());
    const cierre = tablero.columnas!.cierre!;
    // Campo por campo y no `deepEqual` contra un literal: postgres.js devuelve un
    // `Result`, que es un Array con otro prototipo — la igualdad estricta lo ve.
    assert.equal(cierre.conversaciones.length, 0);
    assert.equal(cierre.total, 0);
    assert.equal(cierre.hayMas, false);
  });

  test("en modo tablero `conversaciones` va vacía: la verdad está en `columnas`", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarElTablero(db);

    const tablero = await consultarCola(db, { columnas: COLUMNAS, limit: 30 });
    assert.deepEqual(tablero.conversaciones, []);
    assert.equal(tablero.hayMas, false);
  });

  test("`hayMas` sale del límite de CADA columna, no del total del tablero", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarElTablero(db);

    const tablero = await consultarCola(db, { columnas: COLUMNAS, limit: 1 });
    assert.ok(tablero.columnas);
    // «Te esperan» tiene dos (un mensaje y un comentario): con límite 1 hay más.
    assert.equal(tablero.columnas.interesado!.conversaciones.length, 1);
    assert.equal(tablero.columnas.interesado!.hayMas, true);
    // El total NO es el de la página: es el de la columna entera.
    assert.equal(tablero.columnas.interesado!.total, 2);
  });
});
