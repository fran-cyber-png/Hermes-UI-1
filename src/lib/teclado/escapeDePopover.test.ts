import { describe, expect, it } from 'vitest';
import { reaccionDelPopover, SELECTOR_CAMPOS } from './escapeDePopover';

/**
 * El contrato de cierre — antes copiado a mano en nueve popovers, con cuatro
 * copias que ya habían divergido (#12). Cada caso de acá es uno de esos bugs.
 */
describe('reaccionDelPopover', () => {
  it('Escape fuera de un campo cierra, y frena el evento', () => {
    // Si no lo frenara, el mismo Escape llegaría al listener del shell y
    // cerraría también la conversación de atrás. Le pasaba a BarraFrescura.
    expect(reaccionDelPopover('Escape', false)).toEqual({ tipo: 'cerrar', frenarPropagacion: true });
  });

  it('Escape mientras se escribe es del campo, no del popover', () => {
    // La vendedora tipea el nombre de una etiqueta y aprieta Escape: pierde la
    // palabra, no el formulario. GestorCategorias perdía lo tipeado.
    expect(reaccionDelPopover('Escape', true)).toEqual({ tipo: 'ignorar' });
  });

  it('cualquier otra tecla no cierra nada', () => {
    for (const tecla of ['Enter', 'Tab', 'a', ' ', 'ArrowDown', 'esc', 'Esc']) {
      expect(reaccionDelPopover(tecla, false)).toEqual({ tipo: 'ignorar' });
    }
  });
});

describe('SELECTOR_CAMPOS', () => {
  it('cubre los cuatro lugares donde se escribe', () => {
    // `[contenteditable]` estaba solo en la guarda del shell y faltaba en la de
    // los popovers: la misma tecla se juzgaba distinto según quién la oyera.
    for (const campo of ['input', 'textarea', 'select', '[contenteditable]']) {
      expect(SELECTOR_CAMPOS).toContain(campo);
    }
  });
});
