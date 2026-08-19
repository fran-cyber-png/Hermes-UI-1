import { describe, expect, it } from 'vitest';
import { noEsDeCampana, VEN_ROUTING, veRouting } from './acceso';

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

/**
 * El árbol del front como texto. `import.meta.glob` y **no `node:fs`**: el
 * segundo pasa en vitest y **falla** en `tsc -p tsconfig.app.json`, que no lleva
 * los tipos de node (la cicatriz de `lib/etapas.test.ts`).
 */
const APP: string = Object.values(
  import.meta.glob('../../App.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>,
)[0];

describe('las cuatro vistas que un operador de campaña no tiene', () => {
  it('quien no atiende campaña las ve todas — el default es el riel de siempre', () => {
    expect(noEsDeCampana({ id: 'luz' })).toBe(true);
    expect(noEsDeCampana({ id: 'luz', esDeCampana: false })).toBe(true);
  });

  /**
   * ⚠️ El campo es OPCIONAL: falta en un server viejo y en el atajo de
   * `quienDiceSer`, que arma la vendedora leyendo el token sin preguntar nada.
   * En los dos casos el riel completo es lo correcto — negar de verdad es
   * trabajo del server (`modulos/deEsteModulo.ts`), no de este booleano.
   */
  it('ausente se lee como «no es de campaña», nunca como «sí»', () => {
    expect(noEsDeCampana({ id: 'luz' })).toBe(true);
    expect(noEsDeCampana({})).toBe(true);
    expect(noEsDeCampana(null)).toBe(true);
    expect(noEsDeCampana(undefined)).toBe(true);
  });

  it('quien atiende una campaña no las tiene', () => {
    expect(noEsDeCampana({ id: 'centurion:betto.romero', esDeCampana: true })).toBe(false);
  });

  /**
   * 🔴 EL CANDADO QUE IMPORTA: que las cuatro sigan marcadas en `App.tsx`.
   * Sacarle el `soloPara` a una no rompe ningún test de componente —el riel
   * renderiza lo que su lista diga— y el síntoma es que un operador de campaña
   * ve un ícono de la Escuela. Su gemelo del server, que es el que de verdad
   * niega, es `modulos/superficies.paridad.test.ts`.
   *
   * ⚠️ **`personas` se sumó el 19-ago-2026 y NO es una vista más**: sus dos
   * solapas son el padrón de icarus (ADR 0035) y el buscador de Cerberus por
   * teléfono, o sea que la vista ENTERA es del módulo de ventas. Las dos rutas
   * ya contestan 403, así que dejarla en el riel era un ícono que no abre nada.
   */
  it.each(['correos', 'entrenamiento', 'libreta', 'navegador', 'personas'])(
    'la vista «%s» está marcada con noEsDeCampana en App.tsx',
    (id) => {
      const renglon = APP.split('\n').find((l) => l.includes(`id: '${id}'`));
      expect(renglon, `no encontré la vista «${id}» en App.tsx`).toBeDefined();
      expect(renglon).toContain('soloPara: noEsDeCampana');
    },
  );

  it('y las que SÍ son de todos no la llevan', () => {
    // Las cuatro del MOTOR: sirven igual a ventas y a campaña (`modulos/modulo.ts`
    // no las declara, y ese default —«lo que no está declarado es compartido»—
    // es lo que este test fija del lado del riel).
    for (const id of ['dashboard', 'embudo', 'bandeja', 'agenda']) {
      const renglon = APP.split('\n').find((l) => l.includes(`id: '${id}'`));
      expect(renglon).toBeDefined();
      expect(renglon).not.toContain('soloPara');
    }
  });
});
