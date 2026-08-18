// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { montar } from '../../pruebas/dom';
import { RotuloDeLaCola } from './RotuloDeLaCola';

/**
 * EL CARTEL DEL RECORTE — que el número diga de quién es lo que se está contando.
 *
 * ══ POR QUÉ ES UN TEST DE DOM Y NO UNO PURO ══════════════════════════════════
 *
 * Lo que se fija no es una decisión: es lo que la vendedora LEE. Un test puro
 * sobre una función que devolviera `'para vos'` pasaría igual con el componente
 * pintando otra cosa, y este cartel existe justamente porque durante meses el
 * server sabía del recorte y **la pantalla no lo decía**. Acá se monta y se lee
 * el texto, que es la única forma de que el candado cubra el cableado.
 *
 * ══ 🔴 EL CASO QUE HAY QUE PROTEGER ES EL AUSENTE ════════════════════════════
 *
 * El campo llega del server como opcional: un server viejo no lo manda y una
 * página rehidratada del caché de IndexedDB (ADR 0007) tampoco. Si alguien le
 * pone un default `true` —o lo lee con `?? true`, que es un patrón que este repo
 * usa a propósito en OTROS lugares (`soloMisAsignadas` del Dashboard)—, el cartel
 * afirmaría un recorte sobre una cola que trae el trabajo de todas. Por eso el
 * primer test es el del campo ausente.
 */
describe('el rótulo de la cola', () => {
  test('🔴 sin el campo no afirma NADA: dice «en cola» y no lleva explicación', () => {
    const m = montar(<RotuloDeLaCola total={5494} />);
    const span = m.contenedor.querySelector('span');
    expect(span?.textContent).toBe('5494 en cola');
    // El `title` es la mitad que explica; sin dato no puede haber explicación.
    expect(span?.getAttribute('title')).toBe(null);
    m.desmontar();
  });

  test('con el recorte puesto, el número dice de quién es y por qué', () => {
    const m = montar(<RotuloDeLaCola total={2379} recortada />);
    const span = m.contenedor.querySelector('span');
    expect(span?.textContent).toBe('2379 para vos');
    const ayuda = span?.getAttribute('title') ?? '';
    // No se fija la frase entera —se va a reescribir— sino las dos cosas que
    // tiene que decir: que es suya y que lo huérfano también entra. Sin la
    // segunda mitad, «para vos» promete una cola de asignadas y la vendedora
    // leería como error suyo cada conversación sin dueña que aparezca.
    expect(ayuda).toContain('tu cola');
    expect(ayuda).toContain('dueña');
    m.desmontar();
  });

  test('`recortada={false}` es lo mismo que ausente: no se inventa un recorte', () => {
    const m = montar(<RotuloDeLaCola total={12} recortada={false} />);
    expect(m.contenedor.querySelector('span')?.textContent).toBe('12 en cola');
    m.desmontar();
  });

  /**
   * ⚠️ **EL NÚMERO SE FORMATEA EN `es`, Y `es` NO AGRUPA CUATRO DÍGITOS.**
   * `(5494).toLocaleString('es')` da **`5494`**, sin punto: el CLDR del español
   * pide cinco dígitos para agrupar (`minimumGroupingDigits: 2`). Por eso los
   * casos de arriba esperan `5494` y `2379` pelados y no es un descuido — se
   * verificó contra el mismo ICU que corre en el navegador. Con `es-PE` daría
   * `5,494` (coma), que sería peor. Este caso fija que a partir de cinco dígitos
   * el punto sí aparece: es el que se rompe si alguien cambia el locale.
   */
  test('a partir de cinco dígitos el número va con separador de miles', () => {
    const m = montar(<RotuloDeLaCola total={25386} recortada />);
    expect(m.contenedor.querySelector('span')?.textContent).toContain('25.386');
    m.desmontar();
  });
});
