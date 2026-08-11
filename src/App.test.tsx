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
      'Navegador',
    ]);
  });

  /**
   * El rango de ⌘1..N se DERIVA de `VISTAS` desde la vista de entrenamiento —
   * antes era un `'6'` escrito a mano que se quedó corto sin que nada lo dijera.
   * Esto lo fija: si alguien vuelve a escribir el número, ⌘8 deja de andar acá.
   *
   * Y desde el Navegador (ADR 0040) hay un test gemelo para ⌘9, abajo: la
   * PENÚLTIMA vista seguiría andando con un `'8'` escrito a mano, así que el
   * candado real es siempre el de la ÚLTIMA.
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

/**
 * EL NAVEGADOR COMO NOVENA VISTA (ADR 0040).
 *
 * El candado que importa es el de ⌘9, y hay que decir por qué: el rango de
 * `App.tsx` es `e.key <= String(VISTAS.length)`, así que un `'8'` escrito a mano
 * dejaría andando las ocho primeras y **solo** rompería la última. El test de la
 * Libreta (⌘8) seguiría verde mientras la vista nueva es inalcanzable por
 * teclado — que es exactamente la forma que tuvo el defecto la vez anterior,
 * cuando el número clavado era `'6'`.
 */
describe('el Navegador como novena vista', () => {
  it('⌘9 lo abre: el rango del atajo se sigue derivando de VISTAS', async () => {
    const m = await abrirApp();
    expect(vistaActual(m)).toBe('Dashboard');

    teclear('9', { meta: true });
    await reposar();

    expect(vistaActual(m)).toBe('Navegador');
  });

  /**
   * No se carga perezoso (no tiene por qué: son ~4 KB, no los 269 de BlockNote),
   * así que acá sí alcanza con un turno del event loop. Se verifica que lo que
   * montó es el componente REAL y no un esqueleto — sin esto, el test de arriba
   * podría estar leyendo solo el `h1` de la cabecera.
   */
  it('monta la vista de verdad, con sus destinos', async () => {
    const m = await abrirApp();

    teclear('9', { meta: true });
    await reposar();

    expect(m.contenedor.querySelector('input[aria-label="Dirección"]')).not.toBeNull();
    expect(m.contenedor.textContent).toContain('Cerberus');
  });
});

/**
 * ROUTING COMO DÉCIMA VISTA — y la primera que NO la ve todo el mundo.
 *
 * Dos cosas que ningún test puro puede ver, y por eso están acá:
 *
 *   1. Que el riel de una persona sea distinto del de otra. La regla
 *      (`vistas/acceso.ts`) está testeada aparte; lo que se rompe en el
 *      CABLEADO es que el riel siga leyendo `VISTAS` y las dibuje todas.
 *   2. 🔴 Que ⌘2..⌘9 SIGAN ANDANDO con diez vistas. El rango se comparaba como
 *      CADENA, y `'2' <= '10'` es **false**: con la décima vista quedaba
 *      andando ⌘1 y se rompían las ocho del medio. El candado de la ÚLTIMA
 *      vista —el que atrapó los dos defectos anteriores— no habría visto éste,
 *      porque la décima no tiene tecla.
 */
describe('Routing, la décima vista', () => {
  /** Entra con otro usuario: el riel depende de quién sos, no del build. */
  async function abrirAppComo(id: string): Promise<Montado> {
    localStorage.setItem('hermes.token', tokenVivo(id));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/auth/yo')) {
          return new Response(JSON.stringify({ vendedora: { id, nombre: id }, cerberus: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{"ok":false}', { status: 503, headers: { 'content-type': 'application/json' } });
      }),
    );
    return abrirApp();
  }

  const rielDe = (m: Montado) =>
    [...m.contenedor.querySelectorAll('nav[aria-label="Vistas"] button[data-vista]')].map(
      (b) => b.getAttribute('data-vista'),
    );

  it('está en el riel de alan, última', async () => {
    const m = await abrirAppComo('alan');
    expect(rielDe(m).at(-1)).toBe('routing');
  });

  it('y en el de Usuario1, que entra escribiendo su nombre en minúscula', async () => {
    const m = await abrirAppComo('usuario1');
    expect(rielDe(m)).toContain('routing');
  });

  it('no está en el riel de nadie más', async () => {
    const m = await abrirApp(); // `ana`
    expect(rielDe(m)).not.toContain('routing');
    expect(rielDe(m)).toHaveLength(9);
  });

  /**
   * Se verifica que montó el componente REAL y no solo el `h1` de la cabecera:
   * con el server contestando 503 a todo (ver arriba), la vista cae en su
   * cartel de error, que es su comportamiento escrito. Un esqueleto no diría eso.
   */
  it('se abre desde el riel y monta la vista de verdad', async () => {
    const m = await abrirAppComo('alan');

    m.contenedor.querySelector<HTMLButtonElement>('button[data-vista="routing"]')!.click();
    await reposar();
    await reposar();

    expect(vistaActual(m)).toBe('Routing');
    expect(m.contenedor.textContent).toContain('No se puede mostrar el ruteo');
  });

  /**
   * 🔴 EL CANDADO QUE IMPORTA ACÁ. Con la comparación de cadenas, este test se
   * pone rojo: ⌘4 no hacía nada y la vista seguía siendo el Dashboard.
   */
  it('con diez vistas, ⌘2..⌘9 siguen andando', async () => {
    const m = await abrirAppComo('alan');

    teclear('4', { meta: true });
    await reposar();
    expect(vistaActual(m)).toBe('Mensajes');

    teclear('9', { meta: true });
    await reposar();
    expect(vistaActual(m)).toBe('Navegador');
  });

  /**
   * No hay tecla ⌘10, así que el tooltip no la nombra: prometer una tecla que
   * no existe se prueba una vez, no anda, y no se vuelve a confiar en el resto.
   */
  it('no promete un ⌘10 que no existe', async () => {
    const m = await abrirAppComo('alan');
    const boton = m.contenedor.querySelector('button[data-vista="routing"]');

    expect(boton?.getAttribute('title')).toBe('Routing');
  });

  it('la cabina cuenta las vistas de quien la abre', async () => {
    const m = await abrirAppComo('alan');

    teclear('?');
    await reposar();

    // Nueve teclas para diez vistas: la cabina no inventa la décima.
    expect(m.contenedor.textContent).toContain('⌘9');
    expect(m.contenedor.textContent).not.toContain('⌘10');
  });
});
