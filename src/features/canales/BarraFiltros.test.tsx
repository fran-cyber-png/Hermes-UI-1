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

/**
 * ⚠️ ESTE BLOQUE CAMBIÓ DE REGLA EL 4-AGO-2026, y los tres tests de abajo
 * afirmaban la anterior.
 *
 * Antes el selector ofrecía **todas las líneas vivas** más «Todas», y «Las mías»
 * era una opción más. Eso era razonable con una línea y una vendedora; con cinco
 * vendedoras nuevas que atienden UNA sola, les ponía adelante tres colas ajenas
 * —y dos de esos rótulos se distinguen por una `s` y una tilde, «Ventas Perú» y
 * «Venta Peru»—. Ahora el selector ofrece **lo tuyo** cuando el mapa te asigna
 * algo, y con una sola línea propia directamente no se dibuja: una opción no es
 * una elección. La decisión vive pura en `alcance.ts`; acá se fija el CABLEADO.
 */
describe('el segmentado de línea', () => {
  it('sin líneas propias ofrece «Todas» y las cuatro: fail-open, como siempre', () => {
    const texto = rotulos(pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: false })).join('|');
    expect(texto).toContain('Todas');
    expect(texto).toContain('Escuela');
    expect(texto).toContain('Bot');
  });

  /**
   * EL CASO DE LAS CINCO NUEVAS: una sola línea propia ⇒ el control desaparece.
   * Y con él tiene que desaparecer «Todas», que es la puerta a las colas ajenas.
   */
  it('con UNA línea propia el selector no se dibuja — ni «Todas» ni las ajenas', () => {
    const texto = rotulos(pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: true })).join('|');
    expect(texto).not.toContain('Todas');
    expect(texto).not.toContain('Escuela');
    expect(texto).not.toContain('Las mías');
    // La barra sigue viva: lo que se fue es el selector, no los filtros.
    expect(texto).toContain('Piden info');
  });

  it('con VARIAS propias sí hay elección: «Las mías» + las suyas, sin «Todas»', () => {
    const dosPropias = LINEAS.map((l) => ({ ...l, mias: true }));
    const c = pintar({ lineas: dosPropias, onLinea: () => {}, hayMias: true });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Las mías');
    expect(texto).toContain('Escuela');
    expect(texto).not.toContain('Todas');
  });

  it('«Las mías» manda el valor reservado del MISMO eje, no una bandera aparte', () => {
    const onLinea = vi.fn();
    const c = pintar({ lineas: LINEAS.map((l) => ({ ...l, mias: true })), onLinea, hayMias: true });
    const boton = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((b) =>
      b.textContent?.includes('Las mías'),
    );
    boton?.click();
    expect(onLinea).toHaveBeenCalledWith(LINEA_MIAS);
  });

  it('lo activo se ve activo, y se cambia de línea con un click', () => {
    const onLinea = vi.fn();
    const c = pintar({
      lineas: LINEAS.map((l) => ({ ...l, mias: true })),
      onLinea,
      hayMias: true,
      lineaActiva: LINEA_MIAS,
    });
    const botones = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]'));
    expect(botones.find((b) => b.textContent?.includes('Las mías'))?.getAttribute('aria-pressed')).toBe('true');
    botones.find((b) => b.textContent?.trim() === 'Escuela')?.click();
    expect(onLinea).toHaveBeenCalledWith('51986394450');
  });
});
