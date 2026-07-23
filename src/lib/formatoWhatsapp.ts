/**
 * EL FORMATO DE WHATSAPP — para previsualizar EXACTAMENTE lo que recibe el cliente.
 *
 * WhatsApp marca el texto con caracteres, no con HTML: `*negrita*`, `_cursiva_`,
 * `~tachado~`, ```` ```monoespaciado``` ````, y linkifica las URLs. Si la burbuja
 * pinta el texto crudo, la vendedora ve los asteriscos y no lo que verá el cliente
 * — y no puede previsualizar un mensaje predeterminado (issue #54, #45).
 *
 * Este parser es PURO: convierte el texto en un árbol de nodos (AST) fácil de
 * testear. El componente `TextoWhatsapp` lo pinta. Separarlos es lo que permite
 * fijar el formato con tests sin DOM (el vitest del front corre en `node`).
 *
 * REGLA DE ORO: si algo no matchea, se devuelve CRUDO. Jamás se come un carácter
 * ni se rompe el mensaje — un mensaje mal parseado es peor que uno sin formato.
 *
 * Fidelidad a WhatsApp (no a Markdown): la marca abre solo si el carácter pegado
 * por dentro no es espacio, y cierra en la primera marca igual cuyo carácter
 * previo tampoco es espacio. Es lenient a propósito (`a*b*c` marca «b», igual que
 * WhatsApp) — el objetivo es PARIDAD con lo que el cliente ve, no corrección de
 * Markdown.
 */

export type NodoFormato =
  | { tipo: "texto"; valor: string }
  | { tipo: "negrita"; hijos: NodoFormato[] }
  | { tipo: "cursiva"; hijos: NodoFormato[] }
  | { tipo: "tachado"; hijos: NodoFormato[] }
  | { tipo: "mono"; valor: string }
  | { tipo: "enlace"; href: string; valor: string };

const MARCAS: Record<string, "negrita" | "cursiva" | "tachado"> = {
  "*": "negrita",
  _: "cursiva",
  "~": "tachado",
};

const esEspacio = (c: string): boolean => c === " " || c === "\n" || c === "\t" || c === "\r";

export function parsearWhatsapp(texto: string): NodoFormato[] {
  const nodos: NodoFormato[] = [];
  let buffer = "";
  const volcar = (): void => {
    if (buffer) {
      nodos.push({ tipo: "texto", valor: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < texto.length) {
    // 1. Monoespaciado: ```...``` — contenido LITERAL, no anida.
    if (texto.startsWith("```", i)) {
      const fin = texto.indexOf("```", i + 3);
      if (fin > i + 2) {
        volcar();
        nodos.push({ tipo: "mono", valor: texto.slice(i + 3, fin) });
        i = fin + 3;
        continue;
      }
    }

    // 2. Enlace: se detecta ANTES del énfasis, así un `_` o `~` dentro de una URL
    //    no la parte (WhatsApp linkifica la URL entera).
    const url = detectarEnlace(texto, i);
    if (url) {
      volcar();
      nodos.push({ tipo: "enlace", href: url, valor: url });
      i += url.length;
      continue;
    }

    // 3. Énfasis: *negrita* _cursiva_ ~tachado~.
    const marca = MARCAS[texto[i]];
    if (marca) {
      const cierre = buscarCierre(texto, i);
      if (cierre !== -1) {
        volcar();
        nodos.push({ tipo: marca, hijos: parsearWhatsapp(texto.slice(i + 1, cierre)) });
        i = cierre + 1;
        continue;
      }
    }

    buffer += texto[i];
    i++;
  }
  volcar();
  return nodos;
}

/**
 * ¿Abre un énfasis en `i` y dónde cierra? Abre si el siguiente carácter existe y
 * no es espacio; cierra en la primera marca igual (a partir de i+2, así el
 * contenido nunca es vacío) cuyo carácter previo no es espacio. Devuelve el índice
 * del cierre, o -1 si no hay par válido (→ la marca queda literal).
 */
function buscarCierre(texto: string, i: number): number {
  const marca = texto[i];
  const siguiente = texto[i + 1];
  if (!siguiente || esEspacio(siguiente)) return -1;
  for (let j = i + 2; j < texto.length; j++) {
    if (texto[j] === marca && !esEspacio(texto[j - 1])) return j;
  }
  return -1;
}

/** Si en `i` empieza una URL http(s), la devuelve (sin la puntuación final); si no, null. */
function detectarEnlace(texto: string, i: number): string | null {
  const esHttps = texto.startsWith("https://", i);
  if (!esHttps && !texto.startsWith("http://", i)) return null;

  let j = i;
  while (j < texto.length && !esEspacio(texto[j])) j++;
  // La puntuación final casi nunca es parte del link: "pagá acá: https://x.pe." .
  const url = texto.slice(i, j).replace(/[.,;:!?)\]}>"']+$/, "");

  const minimo = esHttps ? "https://".length : "http://".length;
  return url.length > minimo ? url : null;
}
