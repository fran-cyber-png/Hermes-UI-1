// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { PantallaHechos } from './PantallaHechos';

/**
 * LA PANTALLA DEL CATÁLOGO, MONTADA DE VERDAD.
 *
 * Lo que se mide acá no es el dibujo: es que la pantalla **no mienta sobre lo
 * que la vendedora ve**. El recorte lo hace el server (`vistaPreviaPorMomento`)
 * y viaja en `vistaPrevia`; si esta pantalla lo dedujera de `momentos`, diría
 * «se ve» sobre una frase que el panel recorta — que es justo el estado en el
 * que estaba producción: 27 datos cargados, 3 visibles, y nadie enterado.
 *
 * Y el Escape: es una hoja encima de la app, así que tiene que cerrarse SIN
 * arrastrar la conversación de atrás (ADR 0024).
 */

let montado: Montado | null = null;

/** Un catálogo con la forma del problema real: el precio cargado y nunca visible. */
const CATALOGO = {
  editable: true,
  origen: 'tabla' as const,
  tope: 3,
  hechos: [
    { clave: 'acceso-un-anio', rotulo: 'Acceso un año', texto: 'El acceso dura un año.', momentos: [], orden: 2, activo: true },
    { clave: 'publico-general', rotulo: 'Público general', texto: 'Es para público general.', momentos: [], orden: 3, activo: true },
    { clave: 'quien-certifica', rotulo: 'Quién certifica', texto: 'Certifica Goberna.', momentos: [], orden: 3, activo: true },
    { clave: 'precio-peru', rotulo: 'Precio Perú', texto: 'En Perú son S/500.', momentos: [], orden: 100, activo: true },
    { clave: 'frase-vieja', rotulo: 'Frase vieja', texto: 'Ya no se usa.', momentos: [], orden: 5, activo: false },
  ],
  // Tal como lo mandaría el server: el precio NO entra en ningún momento.
  vistaPrevia: {
    enfriada: ['acceso-un-anio', 'publico-general', 'quien-certifica'],
    cotizada: ['acceso-un-anio', 'publico-general', 'quien-certifica'],
    'material-sin-precio': ['acceso-un-anio', 'publico-general', 'quien-certifica'],
    'primer-contacto': ['acceso-un-anio', 'publico-general', 'quien-certifica'],
    'pidiendo-info': ['acceso-un-anio', 'publico-general', 'quien-certifica'],
    'en-conversacion': ['acceso-un-anio', 'publico-general', 'quien-certifica'],
  },
};

function servidor(cuerpo: unknown = CATALOGO) {
  const espia = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method && init.method !== 'GET' ? { ok: true } : cuerpo), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', espia);
  return espia;
}

beforeEach(() => {
  localStorage.setItem('hermes.token', 'da-igual.no-se-verifica-acá');
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

/**
 * Espera a que la LISTA esté pintada, no a que pase un tick.
 *
 * Un `reposar()` suelto no alcanza: la consulta del catálogo no resuelve en el
 * mismo turno del event loop. Medido acá — con un solo `reposar()` la pantalla
 * todavía muestra únicamente «Agregar un dato», así que un test que buscara una
 * fila la encontraría a veces (según qué archivo pagó el costo de importar) y
 * pasaría por casualidad. Esperar por una marca del contenido lo vuelve
 * determinista.
 */
async function esperarLista(m: Montado): Promise<void> {
  for (let turno = 0; turno < 50; turno++) {
    // Ojo con el centinela: «Qué ve la vendedora» también es el rótulo del
    // botón que abre la tabla en teléfono, y ese se pinta ANTES de que llegue
    // el catálogo. Se espera por «datos prendidos», que solo existe con datos.
    if (m.contenedor.textContent?.includes('datos prendidos')) return;
    await reposar();
  }
  throw new Error('el catálogo nunca terminó de cargar: el test de abajo no probaría nada');
}

async function abrir(cuerpo: unknown = CATALOGO) {
  const espia = servidor(cuerpo);
  montado = montar(<PantallaHechos onCerrar={() => {}} />);
  await esperarLista(montado);
  return { m: montado, espia };
}

/** El botón cuyo texto contiene `texto`. */
function boton(m: Montado, texto: string): HTMLButtonElement | undefined {
  return [...m.contenedor.querySelectorAll('button')].find((b) => b.textContent?.includes(texto));
}

describe('lo que la pantalla dice sobre lo que se ve', () => {
  it('marca «no se ve» el dato que quedó fuera del recorte', async () => {
    const { m } = await abrir();

    const fila = boton(m, 'Precio Perú');
    expect(fila, 'no encontré la fila del precio').toBeTruthy();
    expect(fila!.textContent).toContain('no se ve');
  });

  it('el que sí entra muestra en cuántos momentos, no «no se ve»', async () => {
    const { m } = await abrir();

    const fila = boton(m, 'Acceso un año');
    expect(fila!.textContent).toContain('6/6');
    expect(fila!.textContent).not.toContain('no se ve');
  });

  /**
   * El caso que hace falsa a toda la pantalla si se implementa mal: `precio-peru`
   * tiene `momentos: []` («vale para todos»). Deducir el número de ahí daría 6/6
   * y sería exactamente la mentira que se quiere evitar.
   */
  it('NO deduce el número de `momentos`: el precio vale para todos y aun así no se ve', async () => {
    const { m } = await abrir();
    expect(boton(m, 'Precio Perú')!.textContent).not.toContain('6/6');
  });

  it('la tabla «qué ve la vendedora» dice cuántos hay prendidos y cuántos entran', async () => {
    const { m } = await abrir();
    const texto = m.contenedor.textContent ?? '';

    expect(texto).toContain('Qué ve la vendedora');
    // 4 prendidos de los 5 (uno está apagado) y el tope de 3, los dos del server.
    expect(texto).toMatch(/4[\s\S]{0,40}datos prendidos/);
  });

  it('lo apagado se ve como apagado, no desaparece', async () => {
    const { m } = await abrir();
    const fila = boton(m, 'Frase vieja');
    expect(fila, 'lo apagado tiene que seguir en la lista para poder prenderlo').toBeTruthy();
    expect(fila!.textContent).toContain('apagado');
  });
});

describe('sin la tabla migrada', () => {
  it('lo dice y no ofrece guardar', async () => {
    const { m } = await abrir({ ...CATALOGO, editable: false, origen: 'sin-tabla' });

    expect(m.contenedor.textContent).toContain('no está migrada');
    expect(boton(m, 'Agregar un dato')!.disabled).toBe(true);
  });
});

/**
 * FRONT NUEVO CONTRA SERVER VIEJO — la ventana real, no una hipótesis.
 *
 * N4 despliega el front SOLO y sin restart; el server va por N5, que es un
 * botón que aprieta una persona. Entre los dos hay minutos u horas en las que
 * esta pantalla corre contra un `/api/hechos/catalogo` que todavía no manda
 * `vistaPrevia`. Con el campo tipado como requerido, la pantalla reventaba ahí.
 */
describe('contra un server que todavía no manda el recorte', () => {
  /**
   * La respuesta del server VIEJO, de verdad: sin `tope`, sin `vistaPrevia` y
   * **sin `activo` en cada fila** — ese campo lo agrega `leerCatalogoParaEditar`,
   * que es parte de este mismo despliegue.
   *
   * Antes este fixture reusaba `CATALOGO.hechos`, que ya trae `activo`: el
   * describe decía cubrir la ventana de despliegue y no la modelaba. Un test que
   * miente sobre lo que cubre es peor que no tenerlo — se confía en él.
   */
  const VIEJO = {
    hechos: CATALOGO.hechos.map(({ activo: _a, ...resto }) => resto),
    editable: true,
    origen: 'tabla' as const,
  };

  async function abrirViejo() {
    servidor(VIEJO);
    montado = montar(<PantallaHechos onCerrar={() => {}} />);
    for (let t = 0; t < 50; t++) {
      if (montado.contenedor.textContent?.includes('Acceso un año')) break;
      await reposar();
    }
    return montado;
  }

  it('no revienta: la lista se pinta igual', async () => {
    const m = await abrirViejo();
    expect(boton(m, 'Acceso un año')).toBeTruthy();
    expect(boton(m, 'Precio Perú')).toBeTruthy();
  });

  it('NO afirma «no se ve» sobre nada: no tiene con qué', async () => {
    const m = await abrirViejo();
    expect(m.contenedor.textContent).not.toContain('no se ve');
    expect(m.contenedor.textContent).not.toContain('6/6');
  });

  it('lo dice, en vez de dibujar una tabla falsa', async () => {
    const m = await abrirViejo();
    expect(m.contenedor.textContent).toContain('todavía no manda el recorte');
  });

  it('y editar sigue funcionando: lo único que falta es el recorte', async () => {
    const m = await abrirViejo();
    expect(boton(m, 'Agregar un dato')!.disabled).toBe(false);
  });

  /**
   * Sin `activo` en la respuesta, `h.activo` es `undefined`. Leerlo como falsy
   * pintaba **el catálogo entero** tachado y con la píldora «apagado»: la
   * pantalla afirmando sobre un campo que el server nunca mandó.
   */
  it('sin `activo` NO da todo por apagado: el server no dijo eso', async () => {
    const m = await abrirViejo();
    const texto = m.contenedor.textContent ?? '';
    expect(texto).not.toContain('apagado');
  });
});

describe('el Escape', () => {
  it('cierra la pantalla y NO se lo pasa al shell (o cerraría la conversación de atrás)', async () => {
    servidor();
    const cerrar = vi.fn();
    const recibio: string[] = [];
    const oreja = (e: KeyboardEvent) => recibio.push(e.key);
    window.addEventListener('keydown', oreja);

    montado = montar(<PantallaHechos onCerrar={cerrar} />);
    await esperarLista(montado);
    try {
      teclear('Escape');
    } finally {
      window.removeEventListener('keydown', oreja);
    }

    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(recibio).toEqual([]);
  });
});
