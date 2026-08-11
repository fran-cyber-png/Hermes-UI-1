import { describe, expect, it } from 'vitest';
import { VEN_ROUTING, veRouting } from './acceso';

describe('quién ve Routing', () => {
  it('la ven las dos personas de la lista', () => {
    expect(veRouting('alan')).toBe(true);
    expect(veRouting('Usuario1')).toBe(true);
  });

  it('no la ve nadie más', () => {
    expect(veRouting('luz')).toBe(false);
    expect(veRouting('ventas10@grupogoberna.com')).toBe(false);
  });

  /**
   * 🔴 EL CASO QUE MUERDE EN SILENCIO. `Usuario1` es la grafía que empuja
   * Cerberus y `usuario1` es la que se tipea al entrar — el `vendedoraId` del
   * token sale de lo SEGUNDO. Con comparación exacta esto no da error: da que
   * la vista no aparece nunca y no hay a quién preguntarle por qué.
   */
  it('no le importa la grafía, de ninguno de los dos lados', () => {
    expect(veRouting('usuario1')).toBe(true);
    expect(veRouting('USUARIO1')).toBe(true);
    expect(veRouting('Alan')).toBe(true);
    expect(veRouting(' alan ')).toBe(true);
  });

  it('sin sesión no ve nada — y una cadena vacía no matchea por accidente', () => {
    expect(veRouting(null)).toBe(false);
    expect(veRouting(undefined)).toBe(false);
    expect(veRouting('')).toBe(false);
    expect(veRouting('   ')).toBe(false);
  });

  it('la lista es la que se pidió, y se lee de un solo lado', () => {
    expect([...VEN_ROUTING]).toEqual(['alan', 'Usuario1']);
  });
});
