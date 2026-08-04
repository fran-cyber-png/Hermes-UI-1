// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from './pruebas/dom';
import App from './App';

/**
 * EL CABLEADO DEL TECLADO DEL SHELL — montado de verdad, no razonado.
 *
 * ── Por qué este archivo existe ──
 * Mover la Libreta al riel (ADR 0034) le sacó una rama a la cascada de Escape de
 * `App.tsx`, y ese es exactamente el lugar donde esta app ya se rompió una vez:
 * el defecto de ADR 0024 no estaba en la decisión —`escapeDePopover.ts` está
 * testeado hasta el hueso— sino en el CABLEADO, y **ningún test puro lo vio**.
 * `ConsultaIvi` se comió el Escape de toda la app y dejaron de andar cerrar la
 * conversación, cerrar la Cabina y cerrar la libreta.
 *
 * Así que acá no se testea una función: se monta el shell entero, con su
 * listener real sobre `window`, y se le tiran teclas que viajan.
 *
 * ── Por qué el server contesta 503 a todo ──
 * Solo `/api/auth/yo` responde bien; TODO lo demás falla a propósito. No es
 * pereza: es lo que hace que el test no dependa de la forma del payload de cada
 * pantalla. Con un `{}` amable, `data` existe y los `data?.campo.find(…)` de los
 * hijos revientan; con un fallo, cada uno cae en su estado de error —que ya está
 * escrito, porque la app tiene que sobrevivir a un server caído— y lo que queda
 * en pie es justo lo que se quiere medir: el shell y su teclado. Un componente
 * nuevo en cualquier vista no puede romper este archivo.
 */

let montado: Montado | null = null;

/** Un token que `quienDiceSer` acepta sin server: `<id>|<vencimiento>` en base64url. */
function tokenVivo(id = 'ana'): string {
  const cuerpo = btoa(`${id}|${Date.now() + 60 * 60 * 1000}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${cuerpo}.firma-que-nadie-mira-acá`;
}

beforeEach(() => {
  localStorage.setItem('hermes.token', tokenVivo());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/auth/yo')) {
        return new Response(
          JSON.stringify({ vendedora: { id: 'ana', nombre: 'Ana Lucía' }, cerberus: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{"ok":false,"message":"el test no levanta server"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function abrirApp(): Promise<Montado> {
  montado = montar(<App />);
  await reposar();
  return montado;
}

/** Qué vista está adelante: el `h1` de la cabecera lo dice, y sale de `VISTAS`. */
function vistaActual(m: Montado): string {
  return m.contenedor.querySelector('h1')?.textContent?.trim() ?? '';
}

/**
 * IR A LA LIBRETA Y ESPERAR A QUE ESTÉ DE VERDAD.
 *
 * La Libreta se carga PEREZOSA (269 KB de BlockNote), así que después del atajo
 * lo que hay en pantalla es el esqueleto del `Suspense`, no el componente. Un
 * `await reposar()` suelto no alcanza: medido, tarda ~8 turnos del event loop.
 *
 * Esperar por una marca del componente REAL —su buscador— y no por un contador
 * de turnos es lo que hace que estos tests digan lo que prometen: sin esto, el
 * de «Escape sigue llegando a window» pasaba mirando un `<div>` de carga, que
 * por supuesto no se come ninguna tecla.
 */
async function irALaLibreta(m: Montado, tecla: 'n' | '⌘8' = 'n'): Promise<void> {
  if (tecla === 'n') teclear('n');
  else teclear('8', { meta: true });

  for (let turno = 0; turno < 50; turno++) {
    if (m.contenedor.querySelector('[aria-label="Buscar en tus páginas"]')) return;
    await reposar();
  }
  throw new Error('la Libreta nunca terminó de montarse: el test de abajo no probaría nada');
}

describe('la Libreta como octava vista', () => {
  it('tiene su lugar en el riel, con las otras siete', async () => {
    const m = await abrirApp();
    // `[title*="⌘"]` deja afuera el botón de salir, que comparte el riel y no es una vista.
    const rotulos = [
      ...m.contenedor.querySelectorAll('nav[aria-label="Vistas"] button[title*="⌘"]'),
    ].map((b) => b.textContent?.trim());

    expect(rotulos).toEqual([
      'Dashboard',
      'Pipeline',
      'Contactos',
      'Mensajes',
      'Correos',
      'Agenda',
      'Entrenar bot',
      'Libreta',
    ]);
  });

  /**
   * El rango de ⌘1..N se DERIVA de `VISTAS` desde la vista de entrenamiento —
   * antes era un `'6'` escrito a mano que se quedó corto sin que nada lo dijera.
   * Esto lo fija: si alguien vuelve a escribir el número, ⌘8 deja de andar acá.
   */
  it('⌘8 la abre, y el rango del atajo salió del array', async () => {
    const m = await abrirApp();
    expect(vistaActual(m)).toBe('Dashboard');

    await irALaLibreta(m, '⌘8');

    expect(vistaActual(m)).toBe('Libreta');
  });

  it('«n» sigue andando: lleva a la libreta desde cualquier vista', async () => {
    const m = await abrirApp();
    teclear('4', { meta: true });
    await reposar();
    expect(vistaActual(m)).toBe('Mensajes');

    await irALaLibreta(m);

    expect(vistaActual(m)).toBe('Libreta');
  });

  /**
   * «n» NAVEGA, no alterna. Como hoja se abría y se cerraba con la misma tecla;
   * como vista, alternar significaría que la tecla de ir a la libreta te SACA de
   * la libreta — y no hay a dónde volver que sea obvio.
   */
  it('«n» estando ya en la libreta no te saca de ahí', async () => {
    const m = await abrirApp();
    await irALaLibreta(m);

    teclear('n');
    await reposar();

    expect(vistaActual(m)).toBe('Libreta');
    // Y sigue montada: alternar la habría desmontado, llevándose el borrador.
    expect(m.contenedor.querySelector('[aria-label="Buscar en tus páginas"]')).not.toBeNull();
  });

  it('«n» con el foco en un campo escribe, no navega', async () => {
    const m = await abrirApp();
    const campo = document.createElement('input');
    m.contenedor.appendChild(campo);

    teclear('n', { target: campo });
    await reposar();

    expect(vistaActual(m)).toBe('Dashboard');
  });
});

/**
 * LA CASCADA DE ESCAPE, DESPUÉS DE SACARLE LA RAMA DE LA LIBRETA.
 *
 * Se acortó por ARRIBA (la libreta era la primera). Lo que hay que demostrar es
 * que lo de abajo quedó intacto, y que la vista nueva —que ahora vive montada
 * dentro del shell— no se quedó con la tecla de nadie.
 */
describe('Escape sigue cerrando lo que cerraba', () => {
  it('la cabina se abre con «?» y se cierra con Escape', async () => {
    const m = await abrirApp();
    teclear('?');
    await reposar();
    expect(m.contenedor.textContent).toContain('La cabina');

    teclear('Escape');
    await reposar();

    expect(m.contenedor.textContent).not.toContain('La cabina');
  });

  /** El caso ConsultaIvi, con la vista nueva: parada en la Libreta, Escape sigue siendo del shell. */
  it('la cabina se cierra con Escape TAMBIÉN parada en la Libreta', async () => {
    const m = await abrirApp();
    await irALaLibreta(m);

    teclear('?');
    await reposar();
    expect(m.contenedor.textContent).toContain('La cabina');

    teclear('Escape');
    await reposar();

    expect(m.contenedor.textContent).not.toContain('La cabina');
  });

  /**
   * Y el Escape que no le toca a nadie tiene que SEGUIR VIAJE. Es la medida
   * exacta del defecto de ADR 0024: un listener en captura que corta el evento
   * rompe atajos que ni siquiera están en el archivo que lo registró.
   */
  it('en la Libreta, un Escape que nadie reclama llega igual a window', async () => {
    const m = await abrirApp();
    await irALaLibreta(m);

    const recibio: string[] = [];
    const oreja = (e: KeyboardEvent) => recibio.push(e.key);
    window.addEventListener('keydown', oreja);
    try {
      teclear('Escape');
      await reposar();
    } finally {
      window.removeEventListener('keydown', oreja);
    }

    expect(recibio).toEqual(['Escape']);
    expect(vistaActual(m)).toBe('Libreta');
  });

  it('Escape no saca de la Libreta: de una vista se sale yendo a otra', async () => {
    const m = await abrirApp();
    await irALaLibreta(m);

    teclear('Escape');
    await reposar();

    expect(vistaActual(m)).toBe('Libreta');
    expect(m.contenedor.querySelector('[aria-label="Buscar en tus páginas"]')).not.toBeNull();
  });

  /**
   * Y con el foco EN el buscador de la libreta, Escape es del campo: ni cierra
   * la vista ni se lleva puesta la cabina de atrás. Es la guarda de
   * `SELECTOR_CAMPOS`, aplicada por el shell — o sea, cableado otra vez.
   */
  it('Escape con el foco en el buscador de la libreta no toca nada de atrás', async () => {
    const m = await abrirApp();
    await irALaLibreta(m);
    const buscador = m.contenedor.querySelector<HTMLInputElement>(
      '[aria-label="Buscar en tus páginas"]',
    )!;

    teclear('?');
    await reposar();
    expect(m.contenedor.textContent).toContain('La cabina');

    teclear('Escape', { target: buscador });
    await reposar();

    expect(m.contenedor.textContent).toContain('La cabina');
  });
});

/**
 * LA BÚSQUEDA DE LA LIBRETA ES UN CAMPO, Y LOS ATAJOS SUELTOS NO LA PISAN.
 *
 * Con la libreta como hoja el riesgo era chico; como vista se escribe ahí con
 * toda la app viva detrás, y `i`/`a`/`n` son letras que aparecen en cualquier
 * palabra. La guarda existe (`SELECTOR_CAMPOS`), pero el que la aplica es el
 * shell — o sea, cableado.
 */
describe('escribir en la libreta no dispara atajos', () => {
  it('teclear «i» en un campo no abre la consulta a Ivi', async () => {
    const m = await abrirApp();
    const campo = document.createElement('input');
    m.contenedor.appendChild(campo);

    teclear('i', { target: campo });
    await reposar();

    expect(m.contenedor.textContent).not.toContain('Preguntale a Ivi');
    expect(vistaActual(m)).toBe('Dashboard');
  });

  it('teclear «?» en un campo no abre la cabina', async () => {
    const m = await abrirApp();
    const campo = document.createElement('input');
    m.contenedor.appendChild(campo);

    teclear('?', { target: campo });
    await reposar();

    expect(m.contenedor.textContent).not.toContain('La cabina');
  });
});
