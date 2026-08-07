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
 * · **Y lo segundo también se arregló, por decisión del dueño**: leer BAJA la
 *   conversación. La primera versión de este archivo fijaba lo contrario —«leer
 *   no es atender», el lead que espera sigue esperando— y ese argumento sigue
 *   siendo cierto; lo que lo perdió fue el costo diario: abrir un chat para ver
 *   qué decía lo dejaba clavado arriba, y había que saltearlo a mano una y otra
 *   vez.
 *
 * ⚠️ **Lo que la decisión cuesta**: un chat leído y urgente queda debajo de uno
 * sin leer que no lo es. **La red es el chip «Sin responder»**, que filtra por
 * `NOT respondida` —sin mirar el cursor de lectura— y lleva su número: lo leído
 * y no contestado sigue estando ahí, a un clic. Sin ese chip esta decisión
 * escondería deuda; con él, solo la ordena distinto. Por eso el último test de
 * este archivo lo verifica: **es la condición que hace aceptable a la primera.**
 */

const TEL = '51987654321';
const LINEA = '51984429504';
const CLAVE = `conv:whatsapp:${TEL}:${LINEA}`;
const VENDEDORA = 'ventas10@grupogoberna.com';

test('abrir un chat apaga «sin leer» y lo baja debajo de lo no leído', async (t) => {
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

  // 2 · Y BAJA: queda debajo de todo lo que no se leyó.
  assert.notDeepEqual(despues, antes, 'después de leerla, el orden tiene que cambiar');
  assert.equal(despues[despues.length - 1], TEL, 'la leída va debajo de las que no se leyeron');

  // 3 · 🔴 Pero su URGENCIA no se toca. Lo que cambia es dónde se la muestra, no
  // cuánto se le debe: si mañana se saca este orden, la escala sigue diciendo la
  // verdad sobre quién está esperando. Meter «leído» adentro de `urgencia.ts`
  // habría contaminado la regla que comparte con el radar del Dashboard.
  assert.equal(
    conversacionDespues?.nivel,
    conversacionAntes?.nivel,
    'leer cambia el ORDEN, no la urgencia: el lead sigue esperando lo mismo',
  );
});

test('🔴 lo leído sin responder SIGUE en el chip «Sin responder» — la red de la decisión', async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, { personaId: TEL, numeroPropio: LINEA, occurredAt: new Date() });
  await upsertEstado(db, VENDEDORA, { clave: CLAVE, leido: true });

  // Es la condición que hace aceptable bajar lo leído: si el chip no lo
  // atrapara, leer un chat sin contestarlo lo haría desaparecer de la vista —
  // que es exactamente como se pierde una venta.
  const r = await consultarCola(db, { vendedoraId: VENDEDORA, intencion: 'sin-responder' });
  const filas = r.conversaciones as unknown as { persona_id: string; no_leido?: boolean }[];
  const suya = filas.find((c) => c.persona_id === TEL);

  assert.ok(suya, 'una conversación leída y NO respondida tiene que seguir en «Sin responder»');
  assert.equal(suya?.no_leido, false, 'y estar marcada como leída: son dos cosas distintas');
});

test('marcar «no leído» a mano lo vuelve a subir', async (t) => {
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
  // Y con eso vuelve a la banda de arriba: es la salida para «esta la miré pero
  // la tengo que contestar sí o sí».
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
