import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { baseDePrueba } from '../pruebas/base.js';
import type { ProductoCatalogo } from '../cerberus/productos.js';
import {
  archivarEvento,
  consultarEventos,
  editarEvento,
  registrarEvento,
} from './registrarEvento.js';

/**
 * LOS EVENTOS DEL CONTACTO, CONTRA UNA POSTGRES DE VERDAD (ADR 0008).
 *
 * Lo que se fija acá es lo que ningún test puro puede ver:
 *   · que «preguntó por un curso» ASIENTA el interés (la compuerta de Cotizado
 *     depende de eso, y sin ello el registro se lee como que no sirvió);
 *   · que el evento guarde el nombre que el catálogo resolvió, no el que mandó
 *     el navegador — o el timeline y el chip de la cola dirían dos cosas;
 *   · que la autoría se compare NORMALIZANDO (`Luz` vs `luz`), que en prod es
 *     el mismo humano y con comparación exacta no da error: da silencio.
 */

const CLAVE = 'conv:whatsapp:51900000000:51999999999';

/** El catálogo vivo de Cerberus, inyectado: el test no habla con nadie. */
const CATALOGO = async (): Promise<ProductoCatalogo[]> => [
  {
    id: 'DIPICOT026',
    sku: 'DIPICOT026',
    nombre: 'Diploma en Gestión Pública — Edición 26',
    precioNormal: 350,
    precioPromocion: 250,
    moneda: 'S/',
  },
];
const CATALOGO_CAIDO = async (): Promise<ProductoCatalogo[]> => {
  throw new Error('Cerberus no contesta');
};

async function cuantosIntereses(db: Awaited<ReturnType<typeof baseDePrueba>>): Promise<number> {
  const [f] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM intereses`);
  return f.n;
}

test('un evento común NO toca intereses — anotar un hecho no mueve el embudo', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'ventas10@grupogoberna.com',
    evento: { tipo: 'objecion', curso: null, productoId: null, nota: 'dijo que está caro' },
    catalogo: CATALOGO,
  });

  assert.equal(r.interesAsentado, false);
  assert.equal(await cuantosIntereses(db), 0, 'una objeción no es un interés');
  assert.equal(r.evento.nota, 'dijo que está caro');
  assert.equal(r.evento.vendedoraId, 'ventas10@grupogoberna.com');
});

test('«preguntó por un curso» ASIENTA el interés: si no, Cotizado le rebota a quien acaba de escucharlo', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: {
      tipo: 'pregunto_curso',
      curso: 'Gestión Pública',
      productoId: 'DIPICOT026',
      nota: 'lo ve con su jefe',
    },
    catalogo: CATALOGO,
  });

  assert.equal(r.interesAsentado, true);
  assert.equal(r.motivoInteres, null);
  assert.equal(await cuantosIntereses(db), 1);

  const [interes] = await db.execute<{ curso: string; producto_id: string | null }>(
    sql`SELECT curso, producto_id FROM intereses WHERE clave = ${CLAVE}`,
  );
  // EL MISMO NOMBRE EN LOS DOS LADOS. El navegador mandó «Gestión Pública»
  // (lo que la vendedora tipeó); el catálogo lo resolvió al nombre real. Si el
  // evento guardara el texto crudo, el timeline diría uno y la cola otro.
  assert.equal(interes.curso, 'Diploma en Gestión Pública — Edición 26');
  assert.equal(r.evento.curso, interes.curso, 'el evento y el interés tienen que decir lo mismo');
  assert.equal(interes.producto_id, 'DIPICOT026');
});

test('con Cerberus caído el evento entra igual, y el motivo lo dice', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: { tipo: 'pregunto_curso', curso: 'Gestión Pública', productoId: 'DIPICOT026', nota: null },
    catalogo: CATALOGO_CAIDO,
  });

  // Lo que la vendedora escuchó no se pierde porque Cerberus se colgó.
  assert.ok(r.evento.id > 0, 'el evento tiene que quedar registrado igual');
  assert.equal(r.motivoInteres, 'catalogo_caido');
  assert.equal(r.evento.curso, 'Gestión Pública', 'sin catálogo, queda el texto que vino');
  assert.equal(await cuantosIntereses(db), 1, 'el interés degrada a texto libre, no desaparece');
});

test('un tipo DESCONOCIDO con curso no asienta interés: no sabemos qué afirma', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: { tipo: 'pidio_factura', curso: 'Gestión Pública', productoId: null, nota: null },
    catalogo: CATALOGO,
  });

  assert.equal(r.interesAsentado, false);
  assert.equal(await cuantosIntereses(db), 0, 'asentar de más ensucia la compuerta de Cotizado');
  assert.equal(r.evento.tipo, 'pidio_factura', 'pero el evento se guarda tal cual');
});

test('la consulta trae los de TODO el equipo, del más nuevo al más viejo, con su autora', async (t) => {
  const db = await baseDePrueba(t);

  for (const [vendedora, nota] of [
    ['luz', 'primero'],
    ['ventas10@grupogoberna.com', 'segundo'],
  ] as const) {
    await registrarEvento(db, {
      clave: CLAVE,
      vendedoraId: vendedora,
      evento: { tipo: 'otro', curso: null, productoId: null, nota },
      catalogo: CATALOGO,
    });
  }

  const lista = await consultarEventos(db, CLAVE);
  assert.equal(lista.length, 2, 'la conversación es del equipo: se ven los dos');
  assert.equal(lista[0].nota, 'segundo', 'el más nuevo primero');
  assert.deepEqual(
    lista.map((e) => e.vendedoraId).sort(),
    ['luz', 'ventas10@grupogoberna.com'],
    'quién lo escribió viaja en cada fila — la atribución ES el punto',
  );
});

test('🔴 la autoría se compara NORMALIZANDO: `Luz` y `luz` son la misma persona', async (t) => {
  const db = await baseDePrueba(t);

  // Cerberus empuja `Luz`; ella entra tipeando `luz`. Con comparación exacta,
  // esto no da un error: da que Luz no puede corregir sus propios eventos.
  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'Luz',
    evento: { tipo: 'otro', curso: null, productoId: null, nota: 'como lo escribió Cerberus' },
    catalogo: CATALOGO,
  });

  const editada = await editarEvento(db, {
    id: r.evento.id,
    vendedoraId: 'luz',
    nota: 'corregido por ella misma',
    curso: null,
  });

  assert.equal(editada.ok, true, 'Luz tiene que poder corregir lo que registró Luz');
  assert.equal((editada as { evento: { nota: string } }).evento.nota, 'corregido por ella misma');
  assert.ok((editada as { evento: { editadoAt: Date | null } }).evento.editadoAt, 'queda marcado como editado');
});

test('el evento de OTRA no se toca — y el error la nombra, para poder ir a pedírselo', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'ventas10@grupogoberna.com',
    evento: { tipo: 'otro', curso: null, productoId: null, nota: 'lo que ella escuchó' },
    catalogo: CATALOGO,
  });

  const editada = await editarEvento(db, {
    id: r.evento.id,
    vendedoraId: 'ventas11@grupogoberna.com',
    nota: 'lo cambio yo',
    curso: null,
  });
  assert.equal(editada.ok, false);
  assert.equal((editada as { codigo: string }).codigo, 'no_es_tuyo');
  assert.match((editada as { message: string }).message, /ventas10@grupogoberna\.com/);

  const borrada = await archivarEvento(db, {
    id: r.evento.id,
    vendedoraId: 'ventas11@grupogoberna.com',
  });
  assert.equal(borrada.ok, false, 'borrar tampoco');

  const vivos = await consultarEventos(db, CLAVE);
  assert.equal(vivos[0].nota, 'lo que ella escuchó', 'intacto');
});

test('borrar es ARCHIVAR: sale del timeline y la fila sigue estando', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: { tipo: 'pregunto_curso', curso: 'Gestión Pública', productoId: 'DIPICOT026', nota: null },
    catalogo: CATALOGO,
  });

  const borrada = await archivarEvento(db, { id: r.evento.id, vendedoraId: 'luz' });
  assert.equal(borrada.ok, true);

  assert.equal((await consultarEventos(db, CLAVE)).length, 0, 'no se ve más');
  const [f] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM eventos_contacto`);
  assert.equal(f.n, 1, 'no hay borrado físico: lo que se afirmó y se retiró es un dato');

  // Y el interés NO se des-asienta: puede haberlo dicho por otro lado, y
  // sacarlo en silencio cerraría Cotizado sin que nadie entienda por qué.
  assert.equal(await cuantosIntereses(db), 1);
});

test('un evento archivado ya no se puede editar ni volver a archivar', async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: { tipo: 'otro', curso: null, productoId: null, nota: 'algo' },
    catalogo: CATALOGO,
  });
  await archivarEvento(db, { id: r.evento.id, vendedoraId: 'luz' });

  const otra = await editarEvento(db, { id: r.evento.id, vendedoraId: 'luz', nota: 'x', curso: null });
  assert.equal(otra.ok, false);
  assert.equal((otra as { codigo: string }).codigo, 'no_existe');
});

test('el PATCH no puede agregarle un curso a un evento que no tenía', async (t) => {
  const db = await baseDePrueba(t);

  // Ponerle curso a una objeción por PATCH la convierte en otra cosa sobre la
  // misma fila y el mismo timestamp: eso es reescribir la historia.
  const r = await registrarEvento(db, {
    clave: CLAVE,
    vendedoraId: 'luz',
    evento: { tipo: 'objecion', curso: null, productoId: null, nota: 'está caro' },
    catalogo: CATALOGO,
  });

  const editada = await editarEvento(db, {
    id: r.evento.id,
    vendedoraId: 'luz',
    nota: 'está caro',
    curso: 'Gestión Pública',
  });

  assert.equal(editada.ok, true);
  assert.equal((editada as { evento: { curso: string | null } }).evento.curso, null);
});
