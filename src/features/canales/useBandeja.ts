import type { Intencion } from './types';
import { useInteracciones } from './useInteracciones';

/**
 * La bandeja: una sola cola, todos los canales mezclados.
 *
 * Es un caso particular de `useInteracciones` — sin canal, sin filtro de tipo, y
 * sobre todo el histórico. Nadie trabaja "por canal" cuando lo que corre es el
 * reloj: a la persona que se te vence no te importa si te escribió por Facebook
 * o por Instagram. Para mirar UN canal a fondo está la pantalla del canal.
 */
export function useBandeja(intencion: Intencion) {
  return useInteracciones({ intencion, rango: 'todo' });
}
