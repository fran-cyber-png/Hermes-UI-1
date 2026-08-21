// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, tocar, type Montado } from '../../pruebas/dom';
import { SelectorLinea } from './BarraFiltros';
import { LINEA_MIAS } from '../../dominio/cola';

/**
 * ⚠️ ESTE BLOQUE CAMBIÓ DE REGLA EL 4-AGO-2026, y los tests de abajo la fijan
 * contra el DROPDOWN (`SelectorLinea`), no contra el segmentado viejo — se
 * mudó de `BarraFiltros.tsx` acá el 20-ago-2026 (ver su docblock: la línea y
 * los tabs pasaron a compartir una fila, y un segmentado de N líneas al lado
 * de los tabs repetía el problema de ancho que ya rompió `BarraFiltros` una
 * vez). La regla en sí no cambió, solo la forma: antes el selector ofrecía
 * **todas las líneas vivas** más «Todas», y «Las mías» era una opción más.
 * Ahora ofrece **lo tuyo** cuando el mapa te asigna algo, y con una sola línea
 * propia directamente no se dibuja: una opción no es una elección. La
 * decisión vive pura en `alcance.ts`; acá se fija el CABLEADO.
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

/** Lo mínimo que el selector necesita para pintarse; cada test cambia lo suyo. */
function pintar(props: Partial<Parameters<typeof SelectorLinea>[0]> = {}) {
  montado = montar(<SelectorLinea {...props} />);
  return montado.contenedor;
}

/** El disparador siempre está; el menú solo después de tocarlo. */
function abrir(c: HTMLElement) {
  tocar(c.querySelector('button')!);
}

const opcionesDelMenu = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent?.trim() ?? '');

describe('el selector de línea', () => {
  it('sin `onLinea` no se dibuja nada — sin dueño, no hay control', () => {
    const c = pintar({ lineas: LINEAS });
    expect(c.querySelector('button')).toBeNull();
  });

  it('sin líneas propias ofrece «Todas» y las dos: fail-open, como siempre', () => {
    const c = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: false });
    abrir(c);
    const texto = opcionesDelMenu(c).join('|');
    expect(texto).toContain('Todas');
    expect(texto).toContain('Escuela');
    expect(texto).toContain('Bot');
  });

  /**
   * EL CASO DE LAS CINCO NUEVAS: una sola línea propia ⇒ el control desaparece.
   * Y con él tiene que desaparecer «Todas», que es la puerta a las colas ajenas.
   */
  it('con UNA línea propia el selector no se dibuja — ni el botón existe', () => {
    const c = pintar({ lineas: LINEAS, onLinea: () => {}, hayMias: true });
    expect(c.querySelector('button')).toBeNull();
  });

  it('con VARIAS propias sí hay elección: «Las mías» + las suyas, sin «Todas»', () => {
    const dosPropias = LINEAS.map((l) => ({ ...l, mias: true }));
    const c = pintar({ lineas: dosPropias, onLinea: () => {}, hayMias: true });
    abrir(c);
    const texto = opcionesDelMenu(c).join('|');
    expect(texto).toContain('Las mías');
    expect(texto).toContain('Escuela');
    expect(texto).not.toContain('Todas');
  });

  it('«Las mías» manda el valor reservado del MISMO eje, no una bandera aparte', () => {
    const onLinea = vi.fn();
    const c = pintar({ lineas: LINEAS.map((l) => ({ ...l, mias: true })), onLinea, hayMias: true });
    abrir(c);
    const opcion = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) =>
      b.textContent?.includes('Las mías'),
    );
    tocar(opcion!);
    expect(onLinea).toHaveBeenCalledWith(LINEA_MIAS);
  });

  it('lo activo se marca con el check, y elegir otra cierra el menú y avisa', () => {
    const onLinea = vi.fn();
    const c = pintar({
      lineas: LINEAS.map((l) => ({ ...l, mias: true })),
      onLinea,
      hayMias: true,
      lineaActiva: LINEA_MIAS,
    });
    // El disparador ya muestra la activa, sin abrir nada.
    expect(c.querySelector('button')?.textContent).toContain('Las mías');
    abrir(c);
    const opcion = Array.from(c.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (b) => b.textContent?.trim() === 'Escuela',
    );
    tocar(opcion!);
    expect(onLinea).toHaveBeenCalledWith('51986394450');
    // Elegir cierra el menú: no queda ningún menuitem en el DOM.
    expect(c.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });
});
