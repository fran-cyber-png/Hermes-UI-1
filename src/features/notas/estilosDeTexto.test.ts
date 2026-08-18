import { expect, test } from 'vitest';
import { soloEstilosConocidos } from './editor';
import { ESTILOS_PROPIOS, TAMANO_POR_DEFECTO } from './estilosDeTexto';
import { FUENTES_CANDIDATAS, FUENTE_POR_DEFECTO, fuentesInstaladas } from './fuentesDisponibles';

/**
 * EL SANEADOR DE ESTILOS — la red que hace REVERSIBLE el cambio de esquema.
 *
 * `fuente` y `tamano` son estilos propios: agregarlos cambió lo que se guarda en
 * `notas.doc`. Sin esta función, sacarlos algún día dejaría **la ventana en
 * blanco** en toda página escrita con una fuente elegida — `useCreateBlockNote`
 * construye el editor durante el render y en `src/` no hay ErrorBoundary.
 *
 * Lo que se fija acá es que el saneador **camine todo el árbol**. La tentación al
 * escribirlo es recorrer `content[]` y listo; los estilos también viven dentro de
 * `children[]` (listas anidadas) y de `rows[].cells[]` (tablas), y una ruta
 * olvidada no da error: deja pasar el estilo desconocido justo en el caso raro,
 * que es el que rompe.
 */

const conEstilos = (styles: Record<string, unknown>) => ({ type: 'text', text: 'hola', styles });

test('deja pasar los estilos del paquete y los nuestros', () => {
  const limpio = soloEstilosConocidos(conEstilos({ bold: true, textColor: 'red', fuente: 'Georgia', tamano: '18px' }));
  expect(limpio.styles).toEqual({ bold: true, textColor: 'red', fuente: 'Georgia', tamano: '18px' });
});

test('descarta un estilo que el esquema no conoce', () => {
  const limpio = soloEstilosConocidos(conEstilos({ bold: true, subrayadoDoble: 'x' }));
  expect(limpio.styles).toEqual({ bold: true });
});

test('llega a los estilos ANIDADOS: children y celdas de tabla', () => {
  // El doc va como `unknown[]`, que es como llega de verdad desde el `jsonb`:
  // tiparlo fuerte acá sería afirmar sobre la base algo que nadie verificó.
  const doc: unknown[] = [
    {
      type: 'bulletListItem',
      content: [conEstilos({ inventado: 1 })],
      children: [{ type: 'paragraph', content: [conEstilos({ bold: true, otroInventado: 2 })] }],
    },
    {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [[conEstilos({ tambienInventado: 3 })]] }] },
    },
  ];

  const limpio = soloEstilosConocidos(doc);

  /** Junta todos los `styles` del árbol, sin depender de la forma exacta. */
  function estilosDe(valor: unknown, junta: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(valor)) valor.forEach((v) => estilosDe(v, junta));
    else if (valor !== null && typeof valor === 'object') {
      for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
        if (clave === 'styles') junta.push(v as Record<string, unknown>);
        else estilosDe(v, junta);
      }
    }
    return junta;
  }

  expect(estilosDe(limpio)).toEqual([{}, { bold: true }, {}]);
});

test('no toca nada que no sea `styles`', () => {
  const bloque = { type: 'paragraph', props: { textColor: 'default', inventado: 'x' }, content: [] };
  expect(soloEstilosConocidos(bloque)).toEqual(bloque);
});

test('los nombres de los estilos propios viven en UN solo lugar', () => {
  // `ESTILOS_PROPIOS` es lo que lee el saneador. Si alguien agrega un estilo al
  // esquema y se olvida de esta lista, el saneador lo BORRARÍA al abrir la
  // página — el arreglo se volvería el bug.
  expect([...ESTILOS_PROPIOS]).toEqual(['fuente', 'tamano']);
  for (const estilo of ESTILOS_PROPIOS) {
    expect(soloEstilosConocidos(conEstilos({ [estilo]: 'v' })).styles).toEqual({ [estilo]: 'v' });
  }
});

/**
 * ── LA DETECCIÓN DE FUENTES ─────────────────────────────────────────────────
 *
 * La medición real necesita canvas y jsdom no lo trae; lo que se prueba acá es la
 * DECISIÓN, con un medidor inyectado. Es el patrón puro+wrapper de la casa: la
 * regla se testea, el `document.createElement('canvas')` queda afuera.
 */

/** Un medidor de mentira: sólo «tiene instaladas» las que se le digan. */
const medidorFalso = (instaladas: string[]) => (texto: string, font: string) => {
  const familia = font.match(/"([^"]+)"/)?.[1];
  // Sin comilla es una genérica sola: el ancho base.
  if (!familia) return texto.length * 10;
  return instaladas.includes(familia) ? texto.length * 12 : texto.length * 10;
};

test('sólo se ofrecen las fuentes que la máquina tiene', () => {
  const salida = fuentesInstaladas(FUENTES_CANDIDATAS, medidorFalso(['Arial', 'Georgia']));
  expect(salida.map((f) => f.nombre).sort()).toEqual(['Arial', 'Georgia']);
});

test('sin canvas se ofrecen TODAS — degrada de más, nunca de menos', () => {
  // Es el caso de jsdom y el de un navegador que no deje medir. Ofrecer de menos
  // sería esconderle fuentes a alguien que sí las tiene, y sin forma de notarlo.
  expect(fuentesInstaladas(FUENTES_CANDIDATAS, undefined)).toHaveLength(FUENTES_CANDIDATAS.length);
});

test('se mide la familia SOLA, no la cascada de respaldo', () => {
  // `"Optima, sans-serif"` siempre daría presente: el respaldo existe siempre.
  // Con nada instalado no puede sobrevivir ninguna.
  expect(fuentesInstaladas(FUENTES_CANDIDATAS, medidorFalso([]))).toHaveLength(0);
});

test('la fuente por defecto es una de las candidatas', () => {
  // Si no lo fuera, el selector mostraría un nombre que no está en su propia
  // lista: no habría forma de volver a él después de cambiar.
  expect(FUENTES_CANDIDATAS.map((f) => f.nombre)).toContain(FUENTE_POR_DEFECTO);
});

test('no hay nombres repetidos entre las candidatas', () => {
  const nombres = FUENTES_CANDIDATAS.map((f) => f.nombre);
  expect(new Set(nombres).size).toBe(nombres.length);
});

/**
 * 🔴 EL DEFECTO QUE SE ESTÁ COMPRANDO CON ESTO, Y SU CANDADO.
 *
 * Los dos selectores muestran «Arial» y «16» cuando no hay estilo puesto. Eso es
 * una AFIRMACIÓN sobre el papel, y el papel lo define `index.css`. Son dos
 * archivos distintos diciendo el mismo hecho — exactamente la forma de #37.
 *
 * No se puede unificar: uno vive en Tailwind/CSS y el otro en TypeScript, y no
 * hay un lugar donde los dos lean. Lo que sí se puede es cruzarlos, que es lo que
 * hace este test leyendo la hoja de estilos.
 *
 * Si divergen, el selector dice «16» sobre un texto de 15 y nadie lo nota.
 */
test('el CSS del papel y lo que el selector afirma dicen lo MISMO', async () => {
  const css = await import('../../index.css?raw').then((m) => m.default as string);

  const bloque = css.match(/\.bn-container \.bn-editor\.bn-default-styles \{([\s\S]*?)\}/)?.[1];
  expect(bloque, 'no encontré la regla del papel en index.css').toBeTruthy();

  expect(bloque).toMatch(new RegExp(`font-size:\\s*${TAMANO_POR_DEFECTO}px`));
  // El nombre que muestra el selector tiene que ser el primero de la cascada.
  expect(bloque).toMatch(new RegExp(`font-family:\\s*${FUENTE_POR_DEFECTO}\\b`));
});
