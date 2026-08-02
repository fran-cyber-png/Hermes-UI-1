// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { BarraFiltros } from './BarraFiltros';
import { LINEA_MIAS } from './cola';

/**
 * LO QUE ESTE TEST CUIDA, Y POR QUÉ NO ALCANZABA UN TEST PURO.
 *
 * Las dos reglas nuevas de la barra son de CABLEADO, no de decisión:
 *
 *  1. Los dos chips del bot solo se dibujan cuando tienen algo que decir. El bot
 *     corre en una línea de cuatro; en las otras tres serían dos chips muertos
 *     comiéndose el ancho de los que se usan todos los días. Y al revés: el chip
 *     APARECIENDO es el aviso de que el bot escaló algo.
 *  2. «Las mías» solo se ofrece a quien tiene líneas asignadas — si no, es un
 *     botón que no cambia nada (la misma regla por la que el selector entero no
 *     existe con una sola línea).
 *
 * Las dos se pueden romper sin que falle ningún test puro: son un `filter` y un
 * `&&` adentro del JSX. Es la lección del ADR 0024 aplicada a otro componente.
 */

let montado: Montado | null = null;
afterEach(() => {
  montado?.desmontar();
  montado = null;
});

const LINEAS = [
  { numero: '51986394450', etiqueta: 'Escuela', estado: 'conectado' },
  { numero: '51984429504', etiqueta: 'Bot', estado: 'conectado', mias: true },
];

/** Lo mínimo que la barra necesita para pintarse; cada test cambia lo suyo. */
function pintar(props: Partial<Parameters<typeof BarraFiltros>[0]> = {}) {
  montado = montar(
    <BarraFiltros
      filtroSec=""
      onFiltro={() => {}}
      categoriaActiva={null}
      onCategoria={() => {}}
      onListas={() => {}}
      {...props}
    />,
  );
  return montado.contenedor;
}

const rotulos = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[data-chip]')).map((b) => b.textContent?.trim() ?? '');

describe('los chips del bot', () => {
  it('NO se dibujan cuando el bot no dijo nada (las otras tres líneas)', () => {
    const c = pintar({ conteos: { pideInfo: 12, sinResponder: 30, botEscalada: 0, botCaliente: 0 } });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Piden info');
    expect(texto).not.toContain('Pidió ayuda');
    expect(texto).not.toContain('calientes');
  });

  it('tampoco cuando el server es viejo y ni manda los conteos', () => {
    // Un server sin este cambio no manda `botEscalada`. `undefined` no puede
    // dibujar un chip vacío: se comporta como cero.
    const c = pintar({ conteos: { pideInfo: 12, sinResponder: 30 } });
    expect(rotulos(c).join('|')).not.toContain('Pidió ayuda');
  });

  it('APARECEN con su número cuando el bot escaló algo — el chip nuevo ES el aviso', () => {
    const c = pintar({ conteos: { pideInfo: 12, sinResponder: 30, botEscalada: 3, botCaliente: 14 } });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Pidió ayuda');
    expect(texto).toContain('3');
    expect(texto).toContain('14');
  });

  it('el chip ACTIVO sigue a la vista aunque su recorte lo deje en cero', () => {
    // Si desapareciera al filtrar, la vendedora se quedaría mirando una cola
    // vacía sin el chip que la apaga. Mismo criterio que la categoría activa,
    // que entra a la barra aunque el tope la dejara afuera.
    const c = pintar({ filtroSec: 'bot-escalada', conteos: { pideInfo: 0, sinResponder: 0, botEscalada: 0 } });
    expect(rotulos(c).join('|')).toContain('Pidió ayuda');
  });

  it('filtrar por el chip del bot llama a `onFiltro` con su valor', () => {
    const onFiltro = vi.fn();
    const c = pintar({ onFiltro, conteos: { pideInfo: 0, sinResponder: 0, botEscalada: 3 } });
    const chip = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((b) =>
      b.textContent?.includes('Pidió ayuda'),
    );
    chip?.click();
    expect(onFiltro).toHaveBeenCalledWith('bot-escalada');
  });
});

describe('el segmentado de línea', () => {
  it('ofrece «Las mías» solo cuando el mapa le asigna alguna', () => {
    const conMias = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: true });
    expect(rotulos(conMias).join('|')).toContain('Las mías');
    montado?.desmontar();
    montado = null;

    const sinMias = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: false });
    const texto = rotulos(sinMias).join('|');
    // Sin asignación no hay opción, y sin opción se ve todo: fail-open también acá.
    expect(texto).not.toContain('Las mías');
    expect(texto).toContain('Todas');
  });

  it('«Las mías» manda el valor reservado del MISMO eje, no una bandera aparte', () => {
    const onLinea = vi.fn();
    const c = pintar({ lineas: LINEAS, onLinea, hayMias: true });
    const boton = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((b) =>
      b.textContent?.includes('Las mías'),
    );
    boton?.click();
    expect(onLinea).toHaveBeenCalledWith(LINEA_MIAS);
  });

  it('«Todas» sigue siendo el default y se llega en un click desde «Las mías»', () => {
    const onLinea = vi.fn();
    const c = pintar({ lineas: LINEAS, onLinea, hayMias: true, lineaActiva: LINEA_MIAS });
    const botones = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]'));
    const mias = botones.find((b) => b.textContent?.includes('Las mías'));
    const todas = botones.find((b) => b.textContent?.trim() === 'Todas');
    expect(mias?.getAttribute('aria-pressed')).toBe('true');
    todas?.click();
    expect(onLinea).toHaveBeenCalledWith('');
  });
});
