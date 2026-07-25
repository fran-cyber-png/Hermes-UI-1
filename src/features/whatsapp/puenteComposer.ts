import { guardarBorrador } from './borradorComposer';

/**
 * EL PUENTE AL COMPOSER — «un clic manda tal cual; un clic en el texto lo abre
 * en el composer» (pedido del dueño, 2026-07-25).
 *
 * El panel derecho y la caja de escribir están en dos ramas distintas del árbol
 * de componentes y no comparten estado. Antes que subir el texto del composer a
 * `App.tsx` —donde no le sirve a nadie más y arrastra un re-render de toda la
 * pantalla por cada tecla— este módulo hace de cable: el panel EMITE, el
 * composer ESCUCHA.
 *
 * Vive a nivel de módulo, como `borradorComposer` y por el mismo motivo:
 * sobrevive a que React reuse o desmonte componentes, porque no depende de
 * ellos. Y guarda el borrador antes de avisar, así el texto llega igual si el
 * composer de esa conversación todavía no está montado.
 *
 * Poner texto en la caja **no es enviar**. Esa distinción es la misma de #45 y
 * es la que hace que «sugerir» no se vuelva «mandar solo».
 */

export interface TextoParaComposer {
  telefono: string;
  texto: string;
}

type Escucha = (v: TextoParaComposer) => void;

const escuchas = new Set<Escucha>();

/** Se suscribe. Devuelve la función para desuscribirse (para el `useEffect`). */
export function alPonerEnComposer(fn: Escucha): () => void {
  escuchas.add(fn);
  return () => {
    escuchas.delete(fn);
  };
}

/**
 * Deja el texto en la caja de esa conversación. Guarda el borrador SIEMPRE
 * (aunque nadie escuche) y después avisa a quien esté escuchando.
 */
export function ponerEnComposer(v: TextoParaComposer): void {
  if (!v.telefono || !v.texto) return;
  guardarBorrador(v.telefono, v.texto);
  for (const fn of escuchas) fn(v);
}

/** Solo para tests: deja el puente sin oyentes. */
export function limpiarEscuchas(): void {
  escuchas.clear();
}
