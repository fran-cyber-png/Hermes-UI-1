/**
 * EL BUS DE LOS ACUSES — «✓ Contacto registrado», «✓ Seguimiento agendado».
 *
 * Va aparte del componente que los dibuja (`components/Avisos.tsx`) para que
 * `avisar()` se pueda llamar desde cualquier lado —incluso fuera de React— sin
 * arrastrar un contexto ni un provider. Es deliberadamente lo más chico que
 * sirve: un aviso a la vez, el último gana, sin cola de prioridades.
 *
 * ⚠️ Lo que NO va por acá: nada que la vendedora tenga que DECIDIR, y nada que
 * se pueda deshacer. Un «Deshacer» vive donde está la cosa deshecha (ver el pie
 * de la Libreta), no flotando cuatro segundos sobre otra pantalla.
 */

export interface Aviso {
  id: number;
  texto: string;
}

type Escucha = (a: Aviso) => void;

const escuchas = new Set<Escucha>();
let siguienteId = 1;

/** Mostrar un acuse. */
export function avisar(texto: string): void {
  const aviso = { id: siguienteId++, texto };
  for (const e of escuchas) e(aviso);
}

/** Suscribirse. Devuelve cómo desuscribirse — lo usa el `useEffect` del componente. */
export function escucharAvisos(escucha: Escucha): () => void {
  escuchas.add(escucha);
  return () => void escuchas.delete(escucha);
}
