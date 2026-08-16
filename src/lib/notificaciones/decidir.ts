/**
 * ¿ESTE EVENTO DEL SSE ES UN MENSAJE QUE NOS ESCRIBIERON?
 *
 * Pura y separada de `tiempoReal.ts` para poder testearla sin DOM ni SSE.
 * `direccion` es OPCIONAL en el evento (reacciones y recibos reusan
 * `tipo: 'mensaje'` para pedir un refresco sin ser un mensaje nuevo, y un
 * server viejo que todavía no manda el campo) — ausente se lee como «no
 * sonar», nunca como entrante: la campanita solo suena cuando el server lo
 * afirma explícito.
 */
export function esMensajeEntrante(e: { tipo?: string; direccion?: string }): boolean {
  return e.tipo === 'mensaje' && e.direccion === 'entrante';
}
