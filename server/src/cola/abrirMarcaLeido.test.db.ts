import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertEstado } from './estado.js';
import { consultarCola } from './consultarCola.js';
import { baseDePrueba } from '../pruebas/base.js';
import { sembrarMensaje } from '../pruebas/sembrar.js';

/**
 * ABRIR UN CHAT APAGA EL PUNTO AZUL — Y NO LO MUEVE DE LUGAR.
 *
 * ── El síntoma que reportó el dueño (7-ago-2026) ─────────────────────────
 * «cuando veo el chat y salgo del chat sigue arriba del todo, no pasa abajo
 * como leído». Al investigarlo resultaron ser DOS cosas, y solo una era un bug:
 *
 * · **Bug**: `POST /api/whatsapp/leido/:telefono` mandaba los ticks azules al
 *   lead y no tocaba `estado_conversacion.leido_hasta` — el cursor de lectura de
 *   la vendedora. El mecanismo estaba entero (columna, SQL, ruta) y abrir el
 *   chat no lo usaba, así que el punto de «sin leer» quedaba puesto sobre algo
 *   ya leído.
 * · **No es bug**: que la conversación siga arriba. El orden es
 *   `fijada → nivel de urgencia → antigüedad` y `no_leido` NO participa. Si el
 *   lead escribió y nadie respondió, sigue siendo deuda. **Leer no es atender**,
 *   y esa es la decisión del dueño: mirar algo no puede hacerlo desaparecer de
 *   la cola, porque así es como se pierde una venta.
 *
 * Este test fija las dos mitades. La segunda es la que importa a futuro: es fácil
 * «arreglar» el síntoma metiendo `no_leido` en el ORDER BY, y eso rompería la
 * garantía por la que existe la cola.
 */

const TEL = '51987654321';
const LINEA = '51984429504';
const CLAVE = `conv:whatsapp:${TEL}:${LINEA}`;
const VENDEDORA = 'ventas10@grupogoberna.com';

test('abrir un chat apaga «sin leer» y NO le cambia el lugar en la cola', async (t) => {
  const db = await baseDePrueba(t);

  const hace = (min: number) => new Date(Date.now() - min * 60_000);

  // Tres conversaciones sin responder, de distinta antigüedad. La del medio es
  // la que se va a «abrir».
  await sembrarMensaje(db, { personaId: '51900000001', numeroPropio: LINEA, occurredAt: hace(10) });
  await sembrarMensaje(db, { personaId: TEL, numeroPropio: LINEA, occurredAt: hace(30) });
  await sembrarMensaje(db, { personaId: '51900000003', numeroPropio: LINEA, occurredAt: hace(60) });

  type Fila = { persona_id: string; no_leido?: boolean; nivel?: number };
  const filas = async (): Promise<Fila[]> => {
    const r = await consultarCola(db, { vendedoraId: VENDEDORA });
    return r.conversaciones as unknown as Fila[];
  };
  const posiciones = async () => (await filas()).map((c) => c.persona_id);
  const laNuestra = async () => (await filas()).find((c) => c.persona_id === TEL);

  const antes = await posiciones();
  const conversacionAntes = await laNuestra();

  assert.ok(antes.includes(TEL), 'la conversación tiene que estar en la cola');
  assert.equal(conversacionAntes?.no_leido, true, 'sin abrir, tiene que estar «sin leer»');

  // ── Abrir el chat: lo que ahora hace `POST /leido/:telefono` ──
  await upsertEstado(db, VENDEDORA, { clave: CLAVE, leido: true });

  const despues = await posiciones();
  const conversacionDespues = await laNuestra();

  // 1 · El punto azul se apaga.
  assert.equal(conversacionDespues?.no_leido, false, 'después de abrir NO puede seguir «sin leer»');

  // 2 · 🔴 Y NO se movió. Esta es la mitad que hay que defender: «arreglar» el
  // síntoma metiendo `no_leido` en el ORDER BY haría que un lead leído y no
  // respondido se vaya de la vista.
  assert.deepEqual(despues, antes, 'leer no puede cambiar el orden de la cola');
  assert.equal(
    conversacionDespues?.nivel,
    conversacionAntes?.nivel,
    'leer no puede bajarle la urgencia: sigue esperando respuesta',
  );
});

test('marcar «no leído» a mano vuelve a encender el punto, y tampoco mueve nada', async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: TEL, numeroPropio: LINEA, occurredAt: new Date() });

  const leerla = async () => {
    const r = await consultarCola(db, { vendedoraId: VENDEDORA });
    return (r.conversaciones as unknown as { persona_id: string; no_leido?: boolean }[]).find(
      (c) => c.persona_id === TEL,
    );
  };

  await upsertEstado(db, VENDEDORA, { clave: CLAVE, leido: true });
  assert.equal((await leerla())?.no_leido, false);

  // La acción del menú `···`, que sigue existiendo: volver a marcarla sin leer
  // para acordarse de contestarla.
  await upsertEstado(db, VENDEDORA, { clave: CLAVE, leido: false });
  const vuelta = await leerla();
  assert.equal(vuelta?.no_leido, true, 'marcar «no leído» tiene que volver a encender el punto');
});

test('🔴 el cursor es POR VENDEDORA: que una abra no apaga el punto de la otra', async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: TEL, numeroPropio: LINEA, occurredAt: new Date() });

  await upsertEstado(db, VENDEDORA, { clave: CLAVE, leido: true });

  const otra = await consultarCola(db, { vendedoraId: 'ventas11@grupogoberna.com' });
  const suya = (otra.conversaciones as unknown as { persona_id: string; no_leido?: boolean }[]).find(
    (c) => c.persona_id === TEL,
  );
  assert.equal(
    suya?.no_leido,
    true,
    'la cola es compartida pero el cursor de lectura es de cada una: abrirla yo no se la marca a ella',
  );
});
