import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { EnvioControlado, type OrdenEnvio, type RegistroEnvios } from './envioControlado.js';
import { TransporteFalso } from './transporteFalso.js';

/**
 * LA CITA VIAJA **EN LA ORDEN** — y este archivo existe porque un campo opcional
 * que se pierde entre dos capas no rompe nada visible.
 *
 * Ya pasó, y está escrito en `ordenes.ts`: `automatico` viajaba por la rama de
 * texto y desaparecía en la de media, sin error de tipos, así que el texto del
 * bot quedaba marcado como automático y el flyer del mismo turno como escrito por
 * una persona. Acá el síntoma sería peor de encontrar: el mensaje sale igual, sin
 * la tirita, y quien lo mandó ve la suya en Hermes.
 *
 * Lo que se fija son los dos extremos: que llegue cuando está, y que **no cambie
 * nada** cuando no está.
 */

class RegistroFalso implements RegistroEnvios {
  readonly intentos: OrdenEnvio[] = [];
  private siguiente = 1;
  async registrarIntento(orden: OrdenEnvio): Promise<number> {
    this.intentos.push(orden);
    return this.siguiente++;
  }
  async marcarEnviado(): Promise<void> {}
  async marcarFallido(): Promise<void> {}
}

const LINEA = '51987654321';

const orden = (over: Partial<OrdenEnvio> = {}): OrdenEnvio => ({
  vendedoraId: 'ana',
  numeroPropio: LINEA,
  telefono: '51961506674',
  texto: 'sí, incluye certificado',
  referencia: `conv:whatsapp:51961506674:${LINEA}`,
  ...over,
});

function puerta() {
  const transporte = new TransporteFalso({ telefono: LINEA });
  return { transporte, envio: new EnvioControlado(transporte, new RegistroFalso()) };
}

describe('la cita atraviesa la puerta', () => {
  test('🔴 llega al transporte tal cual, sin que la puerta la interprete', async () => {
    const { transporte, envio } = puerta();

    const r = await envio.enviar(orden({ cita: { mensajeId: 'EL_PRECIO', esNuestro: true, texto: 'S/ 450' } }));

    assert.ok(r.ok);
    assert.deepEqual(transporte.enviados[0].cita, { mensajeId: 'EL_PRECIO', esNuestro: true, texto: 'S/ 450' });
  });

  test('sin cita, el transporte recibe exactamente lo de siempre', async () => {
    const { transporte, envio } = puerta();

    await envio.enviar(orden());

    assert.equal(transporte.enviados[0].cita, undefined, 'un envío normal no puede cambiar de forma');
  });

  test('la cita NO se salta las guardas: con la línea caída no sale nada', async () => {
    // Es la garantía que hace que esto sea un campo de la orden y no un camino
    // paralelo: mismo corta-corriente, mismo chequeo de sesión, misma auditoría.
    const transporte = new TransporteFalso(); // sin vincular
    const envio = new EnvioControlado(transporte, new RegistroFalso());

    const r = await envio.enviar(orden({ cita: { mensajeId: 'X', esNuestro: false } }));

    assert.equal(r.ok, false);
    assert.equal(transporte.enviados.length, 0);
  });

  test('el eco del saliente trae la cita con la receta `wa:` de siempre', async () => {
    // El eco es lo que la vendedora ve en Hermes. Sin la cita ahí, ella manda una
    // respuesta citando, el lead la ve con su tirita, y en Hermes queda un mensaje
    // suelto que no contesta nada.
    const { transporte, envio } = puerta();
    const ecos: (string | null | undefined)[] = [];
    transporte.onMensaje((m) => ecos.push(m.cita?.mensajeExternalId ?? null));

    await envio.enviar(orden({ cita: { mensajeId: 'EL_PRECIO', esNuestro: true } }));

    assert.deepEqual(ecos, ['wa:EL_PRECIO']);
  });
});
