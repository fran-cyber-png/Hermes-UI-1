import { describe, expect, it } from 'vitest';
import { haceCuanto, porQueEsteProducto, rotuloEstado } from './routing';

describe('cómo se dice el estado de una campaña', () => {
  it('los dos que Meta afirma', () => {
    expect(rotuloEstado('activa')).toBe('Activa');
    expect(rotuloEstado('pausada')).toBe('Pausada');
  });

  /**
   * 🔴 Meta tiene más estados de los que este repo conoce y va a agregar más.
   * El server los manda como «desconocido» y la pantalla tiene que DECIRLO: un
   * estado nuevo mostrado como «Pausada» diría que una campaña que está gastando
   * plata no está corriendo.
   */
  it('lo que no se sabe se dice, no se adivina', () => {
    expect(rotuloEstado('desconocido')).toBe('No se sabe');
    // Y un valor que ni siquiera está en el tipo (server más nuevo que el front)
    // cae en la misma rama, nunca en un throw.
    expect(rotuloEstado('recontra_nuevo' as never)).toBe('No se sabe');
  });
});

describe('hace cuánto llegó alguien', () => {
  const AHORA = Date.parse('2026-08-11T18:00:00Z');

  it('cuenta en días, horas, o dice «recién»', () => {
    expect(haceCuanto('2026-08-02T18:00:00Z', AHORA)).toBe('hace 9 días');
    expect(haceCuanto('2026-08-10T18:00:00Z', AHORA)).toBe('hace 1 día');
    expect(haceCuanto('2026-08-11T14:00:00Z', AHORA)).toBe('hace 4 h');
    expect(haceCuanto('2026-08-11T17:50:00Z', AHORA)).toBe('recién');
  });

  /**
   * ⚠️ `null` NO es «hace mucho»: es que por esa campaña no llegó nadie. La fila
   * omite el dato en vez de inventar un plazo.
   */
  it('sin fecha no se inventa un plazo', () => {
    expect(haceCuanto(null, AHORA)).toBeNull();
    expect(haceCuanto('no es una fecha', AHORA)).toBeNull();
  });
});

describe('por qué esta pieza está en este producto', () => {
  /**
   * 🔴 Los tres orígenes se ven IDÉNTICOS en la lista y solo uno puede estar
   * mal. Medido el 18-ago-2026: de 22 cursos de formulario, los 4 mal enlazados
   * son todos `alias` — una coincidencia de palabras. Marcar los tres igual (o
   * ninguno) devolvería la pantalla a «probá de a una a ver cuál falla».
   */
  it('solo la coincidencia por palabras se marca como sospechosa', () => {
    expect(porQueEsteProducto('alias', 'consultoria politica')?.sospechoso).toBe(true);
    expect(porQueEsteProducto('sku', undefined)?.sospechoso).toBe(false);
    expect(porQueEsteProducto('manual', undefined)?.sospechoso).toBe(false);
  });

  it('la coincidencia dice CUÁL palabra la enganchó', () => {
    // Sin el alias a la vista no se puede juzgar si la coincidencia es razonable.
    expect(porQueEsteProducto('alias', 'consultoria politica')?.texto).toContain('consultoria politica');
  });

  it('sin alias no inventa uno, pero sigue avisando que es una coincidencia', () => {
    const r = porQueEsteProducto('alias', undefined);
    expect(r?.sospechoso).toBe(true);
    expect(r?.texto).not.toContain('«');
  });

  /**
   * ⚠️ Ausente = server viejo o respuesta rehidratada del caché de IndexedDB
   * (ADR 0007). La hoja se calla en vez de afirmar «lo decidió alguien» sobre
   * algo que no sabe.
   */
  it('sin origen no dice nada — nunca inventa un porqué', () => {
    expect(porQueEsteProducto(undefined, undefined)).toBeNull();
    expect(porQueEsteProducto(undefined, 'consultoria politica')).toBeNull();
  });

  /**
   * 🔴 Un origen que este front no conoce cae en la rama CONSERVADORA (la que
   * pide revisar), nunca en «lo decidió alguien» ni en un throw. Es la regla de
   * `presentacion.ts` de Ivi: el valor que todavía no existe tiene que poder
   * interrogarse.
   */
  it('un origen desconocido cae en la rama conservadora, no en un throw', () => {
    const r = porQueEsteProducto('inventado' as never, undefined);
    expect(r?.sospechoso).toBe(true);
  });
});
