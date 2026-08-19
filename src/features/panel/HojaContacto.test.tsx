// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, teclear, tocar, type Montado } from '../../pruebas/dom';
import type { Conversacion } from '../../dominio/conversaciones';
import { HojaContacto } from './HojaContacto';

/**
 * EL CABLEADO DEL ESCAPE DE LA HOJA — lo único que un test puro no puede ver.
 *
 * `useEscape` registra en CAPTURA sobre `window` y hace `stopPropagation()`. La
 * decisión de qué cierra está testeada hasta el hueso en `escapeDePopover.ts`, y
 * aun así la app perdió el Escape global una vez (ADR 0024): el defecto estaba en
 * QUIÉN registra el listener y cuándo, que solo se ve montando de verdad.
 *
 * Acá se fija lo que esa lección dejó: con algo encima que ya escucha, esta hoja
 * **no puede quedarse con la tecla**.
 */

const CONTACTO: Conversacion = {
  clave: 'conv:whatsapp:51987654321:51986394450',
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51987654321',
  persona_nombre: 'Javier Peralta',
  numero_propio: '51986394450',
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

function fetchPorDefecto(): typeof fetch {
  return vi.fn((input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/reparto/rueda')) {
      return Promise.resolve(
        new Response(JSON.stringify({ linea: '51986394450', rueda: [], destinos: ['ana', 'luz'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (url.includes('/api/whatsapp/lineas')) {
      return Promise.resolve(
        new Response(JSON.stringify({ lineas: [{ numero: '51986394450', etiqueta: 'Ventas', estado: 'conectado' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    // El panel pregunta por la ficha de Cerberus, el lead-form, las señales y los
    // intereses. Acá no se está probando ninguno: que fallen todos es el estado
    // más parecido a la app sin server, y react-query los absorbe (retry: false).
    return Promise.reject(new Error('sin server en el test'));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchPorDefecto());
});

afterEach(() => {
  vista?.desmontar();
  vista = null;
  vi.unstubAllGlobals();
});

describe('HojaContacto — el Escape', () => {
  it('cierra la hoja', () => {
    const cerrar = vi.fn();
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={cerrar} />);

    teclear('Escape');

    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('CORTA la propagación al cerrar: el shell no tiene que enterarse', () => {
    // Sin el corte, el mismo Escape que cierra la hoja seguiría hasta el listener
    // de `App.tsx` y se llevaría puesta la conversación abierta detrás.
    const delShell = vi.fn();
    window.addEventListener('keydown', delShell);
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={vi.fn()} />);

    teclear('Escape');

    expect(delShell).not.toHaveBeenCalled();
    window.removeEventListener('keydown', delShell);
  });

  it('con `escapeActivo={false}` no cierra Y DEJA PASAR la tecla', () => {
    // El caso real: un modal de compuerta del Pipeline encima. Ese modal maneja
    // su propio Escape; si esta hoja igual se quedara con la tecla, una sola
    // pulsación cerraría las dos cosas — y la vendedora perdería de vista a quién
    // le estaba por registrar la venta.
    const cerrar = vi.fn();
    const delShell = vi.fn();
    window.addEventListener('keydown', delShell);
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={cerrar} escapeActivo={false} />);

    teclear('Escape');

    expect(cerrar).not.toHaveBeenCalled();
    expect(delShell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', delShell);
  });

  it('al desmontarse suelta el listener: la app recupera su Escape', () => {
    // La otra mitad de la lección de ADR 0024. Un listener que sobrevive al
    // desmontaje apaga el Escape de TODA la app, y en silencio.
    const delShell = vi.fn();
    const vistaLocal = montar(<HojaContacto conversacion={CONTACTO} onCerrar={vi.fn()} />);
    vistaLocal.desmontar();

    window.addEventListener('keydown', delShell);
    teclear('Escape');

    expect(delShell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', delShell);
  });

  it('el botón de cerrar hace lo mismo que la tecla', () => {
    const cerrar = vi.fn();
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={cerrar} />);

    const boton = vista.contenedor.querySelector('button[aria-label="Cerrar la ficha"]');
    expect(boton).not.toBeNull();
    tocar(boton!);

    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('muestra el selector de asignación cuando la línea tiene reparto', async () => {
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={vi.fn()} miVendedora="ana" />);
    await reposar();

    const boton = vista.contenedor.querySelector('button[title*="asignar"]');
    expect(boton).not.toBeNull();
    expect(boton?.textContent).toContain('Sin asignar');
  });

  it('muestra "Escribirle" cuando no hay hilo y hay puente', async () => {
    const escribir = vi.fn();
    vista = montar(<HojaContacto conversacion={CONTACTO} onCerrar={vi.fn()} onEscribir={escribir} />);
    await reposar();

    const boton = Array.from(vista.contenedor.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Escribirle'),
    );
    expect(boton).not.toBeNull();
    tocar(boton!);
    expect(escribir).toHaveBeenCalledWith('51987654321');
  });

  it('NO muestra "Escribirle" cuando la conversación ya tiene hilo', async () => {
    const escribir = vi.fn();
    const conHilo = { ...CONTACTO, n: 5 };
    vista = montar(<HojaContacto conversacion={conHilo} onCerrar={vi.fn()} onEscribir={escribir} />);
    await reposar();

    const boton = Array.from(vista.contenedor.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Escribirle'),
    );
    expect(boton).toBeUndefined();
  });
});
