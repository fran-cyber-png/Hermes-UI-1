import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseDePrueba } from '../pruebas/base.js';
import { buscarNotas, crearNota, listarNotas } from './notas.js';

/**
 * 🔴 EL MISMO HUMANO CON DOS GRAFÍAS TIENE QUE VER LO MISMO POR LAS DOS PUERTAS (#386).
 *
 * ── El defecto que este archivo existe para que no vuelva ────────────────
 *
 * Cerberus empuja **`Luz`** a `numero_vendedora` y ella entra tipeando **`luz`**,
 * que es de donde sale el `vendedoraId` del token. Son dos grafías VIVAS del mismo
 * humano en producción — la cicatriz que ADR 0046 documenta.
 *
 * `buscarNotas` normalizaba con `visibleParaSql` y `listarNotas` comparaba con un
 * `eq()` pelado. Resultado: **la lista le daba CERO páginas y el buscador le
 * encontraba esas mismas páginas.** No hay error ni log — hay una libreta vacía,
 * que se lee como «no escribí nada todavía».
 *
 * ── Por qué el candado se escribe así ────────────────────────────────────
 *
 * Los tests que ya existían sembraban y consultaban con **la misma** grafía, así
 * que el defecto convivía con ellos en verde. La única forma de verlo es sembrar
 * con una y preguntar con la otra — y hay que hacerlo por CADA puerta, porque el
 * defecto fue justamente que una puerta normalizaba y la otra no.
 *
 * Verificado por mutación: devolviendo `listarNotas` a `eq(notas.vendedoraId, …)`,
 * el primer test se pone rojo.
 */

/** Las grafías reales medidas en producción, no un caso inventado. */
const COMO_LA_GUARDA_CERBERUS = 'Luz';
const COMO_ENTRA_ELLA = 'luz';

test('listarNotas: sembrado como `Luz`, lo ve `luz` — la libreta privada no puede salir vacía', async (t) => {
  const db = await baseDePrueba(t);

  await crearNota(db, {
    clave: 'general',
    vendedoraId: COMO_LA_GUARDA_CERBERUS,
    texto: 'el playbook del equipo',
  });

  const vistas = await listarNotas(db, { clave: 'general', vendedoraId: COMO_ENTRA_ELLA });

  assert.equal(
    vistas.length,
    1,
    'la libreta salió vacía: `listarNotas` volvió a comparar la autoría sin normalizar',
  );
  assert.equal(vistas[0]?.texto, 'el playbook del equipo');
});

test('listarNotas: y al revés — sembrado como `luz`, lo ve `Luz`', async (t) => {
  const db = await baseDePrueba(t);

  await crearNota(db, { clave: 'general', vendedoraId: COMO_ENTRA_ELLA, texto: 'una nota' });

  const vistas = await listarNotas(db, { clave: 'general', vendedoraId: COMO_LA_GUARDA_CERBERUS });
  assert.equal(vistas.length, 1, 'normalizar de un solo lado es lo único que reabre el agujero');
});

test('las DOS puertas coinciden: lo que lista `listarNotas` es lo que encuentra `buscarNotas`', async (t) => {
  const db = await baseDePrueba(t);

  await crearNota(db, {
    clave: 'general',
    vendedoraId: COMO_LA_GUARDA_CERBERUS,
    texto: 'cuotas y formas de pago',
  });

  const listadas = await listarNotas(db, { clave: 'general', vendedoraId: COMO_ENTRA_ELLA });
  const encontradas = await buscarNotas(db, {
    q: 'cuotas',
    quien: { vendedoraId: COMO_ENTRA_ELLA, espacios: [] },
  });

  // Ésta es la asimetría exacta que se reportó: una puerta veía y la otra no.
  assert.equal(
    listadas.length,
    encontradas.length,
    `la lista devolvió ${listadas.length} y el buscador ${encontradas.length}: las dos puertas divergieron otra vez`,
  );
  assert.equal(listadas.length, 1);
});

test('la libreta de OTRA persona sigue sin verse — normalizar no afloja la frontera', async (t) => {
  const db = await baseDePrueba(t);

  await crearNota(db, { clave: 'general', vendedoraId: 'ana', texto: 'lo de ana' });
  await crearNota(db, { clave: 'general', vendedoraId: COMO_LA_GUARDA_CERBERUS, texto: 'lo de luz' });

  const deLuz = await listarNotas(db, { clave: 'general', vendedoraId: COMO_ENTRA_ELLA });

  assert.equal(deLuz.length, 1, 'se coló una página ajena: normalizar no puede ensanchar el recorte');
  assert.equal(deLuz[0]?.texto, 'lo de luz');
});

test('sin vendedoraId no se cae a «todas»: la libreta privada de nadie es vacía', async (t) => {
  const db = await baseDePrueba(t);

  await crearNota(db, { clave: 'general', vendedoraId: 'ana', texto: 'lo de ana' });

  // Fail-closed, igual que `visibleParaSql`: un recorte que no recorta y no avisa
  // es el defecto que este repo persigue.
  const vistas = await listarNotas(db, { clave: 'general', vendedoraId: '' });
  assert.equal(vistas.length, 0);
});
