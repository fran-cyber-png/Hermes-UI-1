/**
 * LOS DOS SCRAPES QUE CUALQUIER FORMULARIO DE CERBERUS NECESITA.
 *
 * Cerberus no tiene API REST (ver docblock de `venta.ts`): para leer el CSRF
 * vigente o las opciones de un `<select>` no hay más remedio que parsear el HTML
 * que Django renderiza. Vivía DUPLICADO adentro de `venta.ts`, sin exportar —
 * `crearCliente.ts` necesita exactamente lo mismo, y una segunda copia es la
 * receta de #37: el día que Cerberus cambie el markup, una de las dos queda
 * vieja y nadie se entera hasta que un formulario falla en silencio.
 */

export function parseCsrf(html: string): string {
  return html.match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/)?.[1] ?? '';
}

export interface Opcion {
  id: string;
  nombre: string;
}

export function parseOpciones(html: string, name: string): Opcion[] {
  const sel = html.match(new RegExp(`<select[^>]*name="${name}"[\\s\\S]*?</select>`))?.[0] ?? '';
  return [...sel.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], nombre: m[2].trim() }));
}
