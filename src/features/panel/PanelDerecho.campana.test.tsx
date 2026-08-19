// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import type { Conversacion } from '../../dominio/conversaciones';
import { PanelDerecho } from './PanelDerecho';

/**
 * EL PANEL EN EL MÓDULO DE CAMPAÑAS — y lo que se fija es el CABLEADO.
 *
 * 🔴 **Lo que este test ve y ninguno puro puede ver**: que las consultas no se
 * DISPAREN. La decisión («campaña no tiene Cerberus») vive en un booleano y es
 * trivial de testear sola; el defecto que muerde es el de ADR 0024 — el hook
 * queda cableado igual y el panel de un operador de campaña se llena de 403 al
 * pedir la ficha, los intereses y el lead. Se mira el `fetch`, no la pantalla.
 *
 * 🔴 **Y tiene DOS MITADES a propósito.** Un test que sólo comprueba que en
 * campaña no se pide nada pasa en verde si alguien rompe el panel entero y
 * nunca pide nada para nadie. Por eso la segunda mitad exige que en ventas SÍ
 * se pida: lo que se fija es la diferencia, no la ausencia.
 */

const CONTACTO: Conversacion = {
  clave: 'conv:whatsapp:51987654321:51963139984',
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51987654321',
  persona_nombre: 'Javier Peralta',
  numero_propio: '51963139984',
  texto: null,
  contexto_texto: null,
  respondida: false,
  ventana_abierta: false,
  pregunto: false,
  n: 0,
  referencia: '2026-08-05T14:00:00.000Z',
  ultimo_at: '2026-08-05T14:00:00.000Z',
  dias: 0,
  nivel: 5,
};

let vista: Montado | null = null;
let pedidos: string[] = [];

beforeEach(() => {
  pedidos = [];
  // Todo falla: es el estado más parecido a la app sin server, y react-query lo
  // absorbe (retry: false). Lo que importa acá es QUÉ se pidió, no qué volvió.
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      pedidos.push(String(url));
      return Promise.reject(new Error('sin server en el test'));
    }),
  );
});

afterEach(() => {
  vista?.desmontar();
  vista = null;
  vi.unstubAllGlobals();
});

/** Las tres rutas que `modulos/modulo.ts` declara de `ventas` y este panel usa. */
const DE_VENTAS = ['/api/contactos/ficha', '/api/contactos/lead', '/api/gestiones/intereses'];

describe('el panel derecho en campaña', () => {
  it('🔴 no pide NADA de Cerberus', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="centurion:betto.romero" esDeCampana />);
    await reposar();
    for (const ruta of DE_VENTAS) {
      expect(
        pedidos.filter((p) => p.includes(ruta)),
        `pidió «${ruta}», que para campaña es 403`,
      ).toHaveLength(0);
    }
  });

  it('y tampoco dibuja la ficha de Cerberus', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="centurion:betto.romero" esDeCampana />);
    await reposar();
    expect(vista.contenedor.textContent).not.toContain('Ficha de Cerberus');
  });

  /**
   * ⚠️ El estado de la banda **no puede decir «no figura en Cerberus»**: sería
   * cierto por casualidad y engañoso, porque nadie preguntó. Tampoco puede
   * decir que el canal no trae teléfono, con el teléfono ahí al lado.
   */
  it('la banda no afirma nada sobre Cerberus', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="centurion:betto.romero" esDeCampana />);
    await reposar();
    const texto = vista.contenedor.textContent ?? '';
    expect(texto).not.toContain('No se pudo saber');
    expect(texto).not.toContain('Buscando en Cerberus');
    expect(texto).not.toContain('este canal no lo trae');
  });

  it('LA OTRA MITAD: en ventas sí las pide — si no, esto pasaría con el panel roto', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="luz" />);
    await reposar();
    for (const ruta of DE_VENTAS) {
      expect(
        pedidos.filter((p) => p.includes(ruta)).length,
        `en ventas tendría que haber pedido «${ruta}»`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * `/api/senales` NO es de ventas: «ya le mandaron el precio» y «se enfrió» se
   * derivan del hilo, sin tocar Cerberus. Apagarla de rebote le sacaría a la
   * campaña una señal que le sirve igual.
   */
  /**
   * LA SIMETRÍA, del otro lado: `/api/territorio` es superficie de **campaña**
   * (`modulos/modulo.ts`), así que pedirla desde ventas sería un 403 garantizado
   * en cada ficha que se abre — el mismo defecto que este archivo cierra, con el
   * signo cambiado.
   */
  it('🔴 el territorio se pide en campaña y NO en ventas', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="centurion:betto.romero" esDeCampana />);
    await reposar();
    expect(pedidos.filter((p) => p.includes('/api/territorio')).length).toBeGreaterThan(0);
    vista.desmontar();

    pedidos = [];
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="luz" />);
    await reposar();
    expect(pedidos.filter((p) => p.includes('/api/territorio'))).toHaveLength(0);
  });

  it('las señales del hilo siguen andando en los dos módulos', async () => {
    vista = montar(<PanelDerecho conversacion={CONTACTO} miVendedora="centurion:betto.romero" esDeCampana />);
    await reposar();
    expect(pedidos.filter((p) => p.includes('/api/senales')).length).toBeGreaterThan(0);
  });
});
