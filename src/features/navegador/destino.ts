/**
 * QUÉ SIGNIFICA LO QUE LA VENDEDORA TECLEÓ.
 *
 * Puro y fuera del JSX, como toda regla de la casa: un `if` adentro de un
 * componente no se puede interrogar sobre el caso raro, y acá los casos raros
 * son todos (nadie escribe `https://` a mano).
 *
 * 🔴 ESTO NO ES LA GUARDA DE SEGURIDAD. La guarda vive en Rust (`validar()` en
 * `src-tauri/src/lib.rs`) y es la que manda. Acá se normaliza para saber si el
 * botón va habilitado y qué mandar — el mismo reparto que `limitesMedia`: el
 * front frena por conveniencia, la garantía es el rechazo del otro lado. Si las
 * dos dijeran cosas distintas, la que gana es la de Rust, y la pantalla muestra
 * su mensaje tal cual.
 */

/** Lo que se le manda al comando, o el motivo por el que no hay nada que mandar. */
export type Destino =
  | { ok: true; url: string }
  | { ok: false; motivo: 'vacio' | 'no_es_direccion' };

/**
 * ⚠️ **Se asume `https://`, nunca `http://`.** Quien escribe «app.goberna.us»
 * quiere el sitio, no la versión sin cifrar — y como Rust solo acepta https,
 * completar con http acá produciría un rechazo que la vendedora no puede
 * entender («pero si escribí bien la dirección»).
 */
export function interpretar(tecleado: string): Destino {
  const limpio = tecleado.trim();
  if (!limpio) return { ok: false, motivo: 'vacio' };

  // Un esquema explícito se respeta tal cual: si escribió `http://` o algo peor,
  // que lo rechace Rust con su motivo. Taparlo acá volviéndolo https sería
  // decidir por ella algo que no pidió.
  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(limpio) ? limpio : `https://${limpio}`;

  let url: URL;
  try {
    url = new URL(conEsquema);
  } catch {
    return { ok: false, motivo: 'no_es_direccion' };
  }

  // `new URL('https://hola mundo')` NO tira: normaliza el espacio a `%20` y deja
  // un host inválido. Lo que la vendedora escribió era una búsqueda, no un
  // sitio, y abrir `https://hola%20mundo` sería una ventana en blanco.
  if (!url.hostname || !/^[a-z0-9.-]+$/i.test(url.hostname)) {
    return { ok: false, motivo: 'no_es_direccion' };
  }

  // Un host sin punto (`localhost`, `cerberus`) tampoco es un sitio al que
  // llegar desde acá — y sin esta rama, cualquier palabra suelta se leería como
  // una dirección válida.
  if (!url.hostname.includes('.')) return { ok: false, motivo: 'no_es_direccion' };

  return { ok: true, url: url.href };
}

/**
 * LOS DESTINOS FIJOS.
 *
 * No es una lista blanca —el navegador es libre, decisión del dueño del
 * 7-ago-2026—: es dónde se va todos los días, para no tener que teclearlo.
 * Cerberus va primero porque es el único que se abre varias veces por día.
 */
export const DESTINOS: { nombre: string; url: string; para: string }[] = [
  { nombre: 'Cerberus', url: 'https://app.goberna.us', para: 'Fichas, ventas y folios' },
  { nombre: 'Meta Business', url: 'https://business.facebook.com', para: 'Anuncios y bandeja de Meta' },
  { nombre: 'Mattermost', url: 'https://chat.goberna.us', para: 'El chat del equipo' },
  { nombre: 'Grupo Goberna', url: 'https://grupogoberna.com', para: 'Landings y diplomas' },
];
