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

  /**
   * LA RAZÓN POR LA QUE ESTE PR RESCATA LAS DOS PISTAS. Con las cuatro líneas
   * vivas y un chip más, en una sola pista «Te escribieron» —la red que devuelve
   * la deuda entera cuando lo leído baja— quedaba detrás de un scroll invisible.
   */
  it('con las cuatro líneas vivas, «Te escribieron» sigue en la pista de los filtros', () => {
    const c = pintar({
      conteos: { preguntoPrecio: 28, teEscribieron: 454, puedoEscribirle: 47, yaCompraron: 78 },
      lineas: [
        { numero: '51986394450', etiqueta: 'Ventas Perú', estado: 'conectado' },
        { numero: '51941654039', etiqueta: 'Walter Ventas', estado: 'conectado' },
        { numero: '51944531711', etiqueta: 'Venta Perú', estado: 'conectado' },
        { numero: '51984429504', etiqueta: 'Ventas Meta', estado: 'conectado' },
      ],
      onLinea: () => {},
    });
    const pistas = c.querySelectorAll('[role="toolbar"]');
    expect(pistas.length).toBe(2);
    const filtros = Array.from(pistas[1]!.querySelectorAll('[data-chip]')).map(
      (b) => b.textContent?.trim() ?? '',
    );
    expect(filtros.join('|')).toContain('Te escribieron');
    expect(filtros.join('|')).toContain('Puedo escribirle');
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
    expect(texto).toContain('Preguntaron precio');
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

  /**
   * 🔴 DOS PISTAS, NO UNA — y no es cosmética.
   *
   * Compartiendo una sola barra, cuatro líneas vivas se comían los 336 px y
   * «Te escribieron» quedaba fuera de la vista, detrás de un scroll horizontal
   * que no se anuncia. Desde que la cola ordena por la banda de leído, ese chip
   * es la RED DE SEGURIDAD de la cola entera: lo que ya se miró baja, y él lo
   * trae de vuelta. Una red detrás de un scroll invisible no es una red.
   *
   * Se fija la SEPARACIÓN y no el ancho: jsdom no hace layout, así que
   * `scrollWidth` es siempre 0 y «entra sin scrollear» no se puede afirmar acá.
   * Lo que sí se puede romper de un tipeo es el cableado — volver a meter el
   * segmentado adentro de la pista de los filtros—, y eso es lo que se mira.
   */
  it('la línea y los filtros viven en pistas SEPARADAS', () => {
    const c = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: false, conteos: { preguntoPrecio: 12, teEscribieron: 454 } });
    const pistas = Array.from(c.querySelectorAll<HTMLElement>('[role="toolbar"]'));
    expect(pistas).toHaveLength(2);

    const textoDe = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('[data-chip]')).map((b) => b.textContent?.trim() ?? '').join('|');
    expect(textoDe(pistas[0]!)).toContain('Todas');
    expect(textoDe(pistas[0]!)).not.toContain('Te escribieron');
    expect(textoDe(pistas[1]!)).toContain('Te escribieron');
    expect(textoDe(pistas[1]!)).not.toContain('Todas');
  });

  it('sin selector de línea queda UNA sola pista: la de los filtros', () => {
    // Con una línea propia el segmentado no se dibuja (regla de `alcance.ts`), y
    // entonces no hay por qué gastar los 26 px de una fila vacía.
    const c = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: true, conteos: { preguntoPrecio: 12, teEscribieron: 454 } });
    expect(c.querySelectorAll('[role="toolbar"]')).toHaveLength(1);
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
