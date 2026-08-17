import { expect, test } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { DISTANCIA_PROXIMIDAD, nodoMasCercano, organizarConDagre } from './diagramaLayout';

/**
 * LA MATEMÁTICA DEL DIAGRAMA, PURA — sin lienzo montado. Simular un arrastre
 * de verdad en jsdom (que no mide layout) sería fingir un resultado; esto
 * comprueba la regla en sí.
 */

function nodo(id: string, x: number, y: number): Node {
  return { id, type: 'paso', position: { x, y }, data: { label: id } };
}

test('nodoMasCercano da null si no hay nadie a menos de la distancia mínima', () => {
  const arrastrado = nodo('a', 0, 0);
  const lejos = nodo('b', DISTANCIA_PROXIMIDAD + 1, 0);
  expect(nodoMasCercano(arrastrado, [arrastrado, lejos])).toBeNull();
});

test('nodoMasCercano conecta con el más próximo dentro del radio', () => {
  const arrastrado = nodo('a', 100, 100);
  const cerca = nodo('b', 100, 100 + DISTANCIA_PROXIMIDAD - 10);
  const masLejos = nodo('c', 100, 100 + DISTANCIA_PROXIMIDAD - 5);
  const resultado = nodoMasCercano(arrastrado, [arrastrado, cerca, masLejos]);
  expect(resultado).not.toBeNull();
  expect([resultado?.source, resultado?.target]).toContain('b');
});

test('🔴 el ORIGEN es el que está más a la izquierda, sin importar cuál se arrastró', () => {
  const izquierda = nodo('izq', 0, 0);
  const derecha = nodo('der', 50, 0); // arrastrado — está a la derecha
  const resultado = nodoMasCercano(derecha, [izquierda, derecha]);
  expect(resultado).toEqual({ source: 'izq', target: 'der' });

  // Al revés: se arrastra el de la izquierda, la respuesta es la MISMA flecha.
  const resultado2 = nodoMasCercano(izquierda, [izquierda, derecha]);
  expect(resultado2).toEqual({ source: 'izq', target: 'der' });
});

test('nodoMasCercano nunca se ofrece a sí mismo', () => {
  const solo = nodo('a', 0, 0);
  expect(nodoMasCercano(solo, [solo])).toBeNull();
});

test('organizarConDagre (TB) ordena una cadena de arriba hacia abajo', () => {
  const nodos: Node[] = [nodo('1', 500, 500), nodo('2', 10, 10), nodo('3', 900, 900)];
  const conexiones: Edge[] = [
    { id: 'e1', source: '1', target: '2', type: 'personalizado' },
    { id: 'e2', source: '2', target: '3', type: 'personalizado' },
  ];
  const organizados = organizarConDagre(nodos, conexiones, 'TB');
  const y1 = organizados.find((n) => n.id === '1')!.position.y;
  const y2 = organizados.find((n) => n.id === '2')!.position.y;
  const y3 = organizados.find((n) => n.id === '3')!.position.y;
  // El orden del flujo (1→2→3) queda en el eje Y, no en el X aleatorio de antes.
  expect(y1).toBeLessThan(y2);
  expect(y2).toBeLessThan(y3);
});

test('organizarConDagre (LR) ordena la misma cadena de izquierda a derecha', () => {
  const nodos: Node[] = [nodo('1', 500, 500), nodo('2', 10, 10), nodo('3', 900, 900)];
  const conexiones: Edge[] = [
    { id: 'e1', source: '1', target: '2', type: 'personalizado' },
    { id: 'e2', source: '2', target: '3', type: 'personalizado' },
  ];
  const organizados = organizarConDagre(nodos, conexiones, 'LR');
  const x1 = organizados.find((n) => n.id === '1')!.position.x;
  const x2 = organizados.find((n) => n.id === '2')!.position.x;
  const x3 = organizados.find((n) => n.id === '3')!.position.x;
  expect(x1).toBeLessThan(x2);
  expect(x2).toBeLessThan(x3);
});

test('organizarConDagre no revienta con nodos sueltos (sin ninguna conexión)', () => {
  const nodos: Node[] = [nodo('1', 0, 0), nodo('2', 500, 500)];
  expect(() => organizarConDagre(nodos, [], 'TB')).not.toThrow();
  expect(organizarConDagre(nodos, [], 'TB')).toHaveLength(2);
});

test('organizarConDagre ignora bordes colgantes (a un nodo que no está en la lista)', () => {
  const nodos: Node[] = [nodo('1', 0, 0)];
  const conexiones: Edge[] = [{ id: 'e1', source: '1', target: 'fantasma', type: 'personalizado' }];
  expect(() => organizarConDagre(nodos, conexiones, 'TB')).not.toThrow();
});
