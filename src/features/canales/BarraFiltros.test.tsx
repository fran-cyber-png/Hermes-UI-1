// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { BarraFiltros } from './BarraFiltros';

/**
 * LO QUE ESTE TEST CUIDA, Y POR QUÉ NO ALCANZABA UN TEST PURO.
 *
 * Los dos chips del bot solo se dibujan cuando tienen algo que decir. El bot
 * corre en una línea de cuatro; en las otras tres serían dos chips muertos
 * comiéndose el ancho de los que se usan todos los días. Y al revés: el chip
 * APARECIENDO es el aviso de que el bot escaló algo.
 *
 * Se puede romper sin que falle ningún test puro: es un `filter` adentro del
 * JSX. Es la lección del ADR 0024 aplicada a otro componente.
 *
 * ⚠️ El segmentado de línea («Las mías», «Todas»...) ya NO vive acá — se mudó
 * a `SelectorLinea` (`BarraFiltros.tsx`, ver su docblock) el 20-ago-2026, y
 * sus tests de cableado están en `SelectorLinea.test.tsx`.
 */

let montado: Montado | null = null;
afterEach(() => {
  montado?.desmontar();
  montado = null;
});

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

/**
 * «PUEDO ESCRIBIRLE» — la ventana de conversación (ADR 0041). Va acá y no en un
 * test puro por el mismo motivo que los del bot: qué chip se dibuja y con qué
 * número es CABLEADO, y `conteoDe` es una cadena de ternarios adentro del
 * componente. Meter el valor nuevo en el lugar equivocado de esa cadena no
 * rompe ningún test puro — deja el chip mostrando el conteo de otro filtro.
 */
describe('el chip de la ventana de conversación', () => {
  it('se dibuja SIEMPRE con su número: la ventana no es cosa de una línea sola', () => {
    const c = pintar({ conteos: { preguntoPrecio: 12, teEscribieron: 30, puedoEscribirle: 47 } });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Puedo escribirle');
    expect(texto).toContain('47');
  });

  it('el número que muestra es el SUYO, no el del chip de al lado', () => {
    const c = pintar({
      conteos: { preguntoPrecio: 12, teEscribieron: 30, puedoEscribirle: 47, yaCompraron: 78 },
    });
    const chip = rotulos(c).find((r) => r.includes('Puedo escribirle')) ?? '';
    expect(chip).toContain('47');
    expect(chip).not.toContain('78');
    expect(chip).not.toContain('30');
  });

  it('un server viejo no manda el conteo y el chip sale sin número, no con un 0 falso', () => {
    const c = pintar({ conteos: { preguntoPrecio: 12, teEscribieron: 30 } });
    const chip = rotulos(c).find((r) => r.includes('Puedo escribirle')) ?? '';
    expect(chip).toContain('Puedo escribirle');
    expect(chip).not.toContain('0');
  });
});

describe('los chips del bot', () => {
  it('NO se dibujan cuando el bot no dijo nada (las otras tres líneas)', () => {
    const c = pintar({ conteos: { preguntoPrecio: 12, teEscribieron: 30, botEscalada: 0, botCaliente: 0 } });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Preguntaron precio');
    expect(texto).not.toContain('Pidió ayuda');
    expect(texto).not.toContain('calientes');
  });

  it('tampoco cuando el server es viejo y ni manda los conteos', () => {
    // Un server sin este cambio no manda `botEscalada`. `undefined` no puede
    // dibujar un chip vacío: se comporta como cero.
    const c = pintar({ conteos: { preguntoPrecio: 12, teEscribieron: 30 } });
    expect(rotulos(c).join('|')).not.toContain('Pidió ayuda');
  });

  it('APARECEN con su número cuando el bot escaló algo — el chip nuevo ES el aviso', () => {
    const c = pintar({ conteos: { preguntoPrecio: 12, teEscribieron: 30, botEscalada: 3, botCaliente: 14 } });
    const texto = rotulos(c).join('|');
    expect(texto).toContain('Pidió ayuda');
    expect(texto).toContain('3');
    expect(texto).toContain('14');
  });

  it('el chip ACTIVO sigue a la vista aunque su recorte lo deje en cero', () => {
    // Si desapareciera al filtrar, la vendedora se quedaría mirando una cola
    // vacía sin el chip que la apaga. Mismo criterio que la categoría activa,
    // que entra a la barra aunque el tope la dejara afuera.
    const c = pintar({ filtroSec: 'bot-escalada', conteos: { preguntoPrecio: 0, teEscribieron: 0, botEscalada: 0 } });
    expect(rotulos(c).join('|')).toContain('Pidió ayuda');
  });

  it('filtrar por el chip del bot llama a `onFiltro` con su valor', () => {
    const onFiltro = vi.fn();
    const c = pintar({ onFiltro, conteos: { preguntoPrecio: 0, teEscribieron: 0, botEscalada: 3 } });
    const chip = Array.from(c.querySelectorAll<HTMLButtonElement>('[data-chip]')).find((b) =>
      b.textContent?.includes('Pidió ayuda'),
    );
    chip?.click();
    expect(onFiltro).toHaveBeenCalledWith('bot-escalada');
  });
});

