import { expect, test } from 'vitest';
import { ANCHO_COMPACTO, acomodar, modoPara, type GrupoMedido } from './acomodar';

/**
 * EL ACOMODO DE LA RIBBON — la única forma de discutirlo.
 *
 * 🔴 **Ningún test de DOM puede ver esto.** jsdom no hace layout: todos los
 * `offsetWidth` dan cero, así que para él cualquier implementación de esto es
 * correcta. Es literalmente el agujero por el que la barra anterior quedó 60 vh
 * más abajo con los tests en verde (ADR 0024). Por eso la decisión vive pura y
 * lo que se prueba es la REGLA, no el dibujo.
 */

const g = (id: string, prioridad: 1 | 2, ancho?: number): GrupoMedido => ({ id, prioridad, ancho });

/** «Inicio», con anchos del orden de los reales. */
const INICIO = [
  g('portapapeles', 2, 150),
  g('fuente', 1, 320),
  g('parrafo', 1, 260),
  g('estilos', 2, 200),
];

test('si entra todo, no se saca nada', () => {
  expect(acomodar(1920, INICIO)).toEqual({
    visibles: ['portapapeles', 'fuente', 'parrafo', 'estilos'],
    enOverflow: [],
  });
});

test('cuando no entra, caen los SECUNDARIOS y desde el final', () => {
  // 930 de ancho natural. A 800 tiene que irse «estilos» (el último secundario)
  // y con eso 730 + 46 del botón «Más» entra.
  expect(acomodar(800, INICIO)).toEqual({
    visibles: ['portapapeles', 'fuente', 'parrafo'],
    enOverflow: ['estilos'],
  });
});

test('🔴 los primarios no se van NUNCA, aunque siga sin entrar', () => {
  // A 300 px no entra ni «Fuente» sola. Lo que NO puede pasar es que se vayan:
  // una Ribbon sin negrita ni viñetas no es una barra angosta, es una rota.
  const r = acomodar(300, INICIO);
  expect(r.visibles).toEqual(['fuente', 'parrafo']);
  expect(r.enOverflow).toEqual(['portapapeles', 'estilos']);
});

test('lo que cae al «Más» conserva el orden de la barra', () => {
  // Se sacan del final hacia adelante, pero se listan como estaban: el
  // desplegable no puede mostrar los grupos al revés de como se aprendieron.
  const r = acomodar(300, INICIO);
  expect(r.enOverflow).toEqual(['portapapeles', 'estilos']);
});

test('⚠️ un grupo que no ayuda no se saca', () => {
  // El botón «Más» ocupa 46. Sacar un grupo de 40 deja la fila MÁS ancha que
  // antes: es la clase de arreglo que empeora lo que venía a arreglar.
  const grupos = [g('grande', 1, 500), g('chiquito', 2, 40)];
  expect(acomodar(520, grupos)).toEqual({ visibles: ['grande', 'chiquito'], enOverflow: [] });
});

/**
 * 🔴 LA PROPIEDAD QUE IMPIDE EL PARPADEO.
 *
 * El bucle clásico de una barra que se acomoda sola es: escondo → ahora entra →
 * muestro → no entra → escondo. Acá la decisión no mira lo que hoy se ve, así
 * que aplicarla sobre su propio resultado tiene que dar lo mismo.
 */
test('aplicar la decisión dos veces da lo mismo (no oscila)', () => {
  const primera = acomodar(800, INICIO);
  const segunda = acomodar(800, INICIO);
  expect(segunda).toEqual(primera);

  // Y con los grupos ya repartidos, volver a preguntar no mueve nada.
  const soloVisibles = INICIO.filter((x) => primera.visibles.includes(x.id));
  expect(acomodar(800, soloVisibles).enOverflow).toEqual([]);
});

test('un grupo sin medir se MUESTRA, para poder medirlo', () => {
  // Degrada hacia mostrar de más, nunca de menos: al revés, un grupo que nunca
  // se dibuja nunca se mide, y se queda escondido para siempre.
  const grupos = [g('a', 1, 500), g('b', 2, undefined)];
  expect(acomodar(100, grupos)).toEqual({ visibles: ['a', 'b'], enOverflow: [] });
});

test('sin ancho de contenedor no se esconde nada', () => {
  // Es el caso de jsdom y el del primer render, antes del layout. Esconder ahí
  // dejaría la barra recortada en cualquier test de DOM y en el primer cuadro.
  expect(acomodar(0, INICIO).enOverflow).toEqual([]);
});

test('el modo compacto entra por ancho, y sin medida se asume holgado', () => {
  expect(modoPara(1920)).toBe('completo');
  expect(modoPara(ANCHO_COMPACTO)).toBe('completo');
  expect(modoPara(ANCHO_COMPACTO - 1)).toBe('compacto');
  // Sin medir: compacto de arranque haría parpadear toda pantalla grande, que
  // es el caso normal.
  expect(modoPara(0)).toBe('completo');
});
