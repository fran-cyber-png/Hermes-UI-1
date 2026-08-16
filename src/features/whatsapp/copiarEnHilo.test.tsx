// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * COPIAR UN MENSAJE DEL HILO.
 *
 * ── Qué vigila, y por qué no alcanzaba con mirarlo ────────────────────────
 * Hasta este frente no había NINGUNA forma de copiar un mensaje desde Hermes
 * (`navigator.clipboard` se usaba en siete lugares de `src/` y en ninguno de
 * `features/whatsapp/`). La vendedora lo buscaba porque WhatsApp lo tiene.
 *
 * Lo que se fija acá son las tres decisiones que se pueden perder en un
 * refactor sin que se caiga nada:
 *   · el botón está en los DOS sentidos (copiar lo PROPIO es el caso más
 *     frecuente: el precio que ya se pasó, el link de pago);
 *   · no depende de la sesión de WhatsApp —copiar es local—, al revés que
 *     reaccionar;
 *   · sin texto no se dibuja, porque copiar la cadena vacía parece que anduvo.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${NUMERO_PROPIO}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Javier',
  numero_propio: NUMERO_PROPIO,
  texto: 'hola',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 1,
  referencia: 'r1',
  ultimo_at: new Date().toISOString(),
  dias: 0,
  nivel: 0,
} as Conversacion;

const AHORA = new Date().toISOString();
const TEXTO_SALIENTE = 'El diploma sale S/ 450 y se puede pagar en dos cuotas.';

let montado: Montado | null = null;

/**
 * `navigator.clipboard` NO EXISTE EN JSDOM, y tampoco es escribible: se define
 * sobre el `navigator` real con `configurable`, y se saca en el `afterEach`. Un
 * `vi.stubGlobal('navigator', …)` reemplazaría el objeto entero y se llevaría
 * puesto todo lo demás que la app le pregunta.
 */
function portapapeles() {
  const escrito: string[] = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: async (t: string) => void escrito.push(t) },
    configurable: true,
  });
  return escrito;
}

function conMensajes(mensajes: unknown[], estadoSesion = 'conectado') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: estadoSesion, telefono: NUMERO_PROPIO });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes, origen: null });
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis.navigator, 'clipboard');
});

async function abrir(): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} />);
  await reposar();
  montado = m;
  return m;
}

/** Los botones de copiar que hay dibujados, por su nombre accesible. */
function botonesCopiar(m: Montado): HTMLButtonElement[] {
  return [...m.contenedor.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith('Copiar'),
  );
}

const SALIENTE = {
  id: 1,
  direccion: 'saliente',
  autor: 'luz',
  texto: TEXTO_SALIENTE,
  occurred_at: AHORA,
  external_id: 'wa:1',
};
const ENTRANTE = {
  id: 2,
  direccion: 'entrante',
  autor: TELEFONO,
  texto: '¿Y con tarjeta?',
  occurred_at: AHORA,
  external_id: 'wa:2',
};

describe('copiar un mensaje', () => {
  test('🔴 tocar el botón de un saliente escribe SU texto en el portapapeles', async () => {
    const escrito = portapapeles();
    conMensajes([SALIENTE, ENTRANTE]);
    const m = await abrir();

    const boton = botonesCopiar(m)[0];
    expect(boton, 'no hay botón de copiar en el hilo').toBeTruthy();
    tocar(boton);
    await reposar();

    expect(escrito).toEqual([TEXTO_SALIENTE]);
  });

  test('el acuse dice «Copiado», no solo cambia un ícono', async () => {
    portapapeles();
    conMensajes([SALIENTE]);
    const m = await abrir();

    expect(m.contenedor.textContent).not.toContain('Copiado');
    tocar(botonesCopiar(m)[0]);
    await reposar();
    expect(m.contenedor.textContent).toContain('Copiado');
  });

  test('los dos sentidos lo tienen: copiar lo propio es el caso más frecuente', async () => {
    portapapeles();
    conMensajes([SALIENTE, ENTRANTE]);
    const m = await abrir();
    expect(botonesCopiar(m)).toHaveLength(2);
  });

  /**
   * Reaccionar necesita la línea viva porque manda algo; copiar no manda nada.
   * Atarlos a la misma condición dejaría a la vendedora sin la única acción que
   * sí puede hacer justo cuando la sesión se cayó.
   */
  test('🔴 con la sesión caída se puede copiar igual (pero no reaccionar)', async () => {
    portapapeles();
    conMensajes([SALIENTE, ENTRANTE], 'desconectado');
    const m = await abrir();

    expect(botonesCopiar(m)).toHaveLength(2);
    const reaccionar = [...m.contenedor.querySelectorAll('button')].filter((b) =>
      (b.getAttribute('title') ?? '').includes('Reaccionar'),
    );
    expect(reaccionar).toHaveLength(0);
  });

  test('un mensaje sin texto no dibuja el botón', async () => {
    portapapeles();
    conMensajes([
      { id: 3, direccion: 'entrante', autor: TELEFONO, texto: null, occurred_at: AHORA, external_id: 'wa:3' },
    ]);
    const m = await abrir();
    expect(botonesCopiar(m)).toHaveLength(0);
  });

  /**
   * El botón vive SIEMPRE en el DOM y se esconde con opacidad (el molde de
   * `BotonReaccionar`). Montarlo recién al pasar el mouse haría que el primer
   * clic caiga en la nada: el `mouseenter` lo monta y el `mousedown` ya viajó.
   * jsdom no hace hover, así que lo que se puede fijar —y lo que importa— es que
   * el nodo exista sin ninguna interacción previa.
   */
  test('🔴 está en el DOM antes de cualquier hover, escondido con opacidad', async () => {
    portapapeles();
    conMensajes([SALIENTE]);
    const m = await abrir();
    const boton = botonesCopiar(m)[0];
    expect(boton.className).toContain('opacity-0');
    expect(boton.className).toContain('group-hover/burbuja:opacity-100');
    // Y alcanzable por teclado: se ve también al enfocarlo, no solo con el mouse.
    expect(boton.className).toContain('focus-visible:opacity-100');
  });
});
