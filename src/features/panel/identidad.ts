/**
 * CÓMO SE LLAMA ESTA PERSONA — con tres nombres compitiendo y ninguno confiable.
 *
 * En producción el pushname de WhatsApp es, muy seguido, «🦋W», «.» o «10 ❤️L»:
 * no sirve para encabezar nada ni para meterlo en un `{nombre}` de plantilla.
 * Al mismo tiempo hay 26.075 leads con el nombre que la persona **escribió ella
 * misma** en el formulario, y las fichas de Cerberus con el nombre legal.
 *
 * La precedencia es la del dato más comprometido: Cerberus (firmó una venta) >
 * formulario (lo tipeó) > pushname (se lo puso para sus amigos).
 *
 * El pushname NO se tira: se muestra como segunda línea cuando difiere, porque
 * es el nombre que aparece en la cola y en el teléfono de la vendedora. Sin eso,
 * el panel diría «Javier Zeballos» mientras el chat dice «javier» y nadie sabría
 * si son la misma persona.
 */

export type FuenteNombre = 'cerberus' | 'formulario' | 'whatsapp' | 'ninguna';

export interface NombreDelContacto {
  /** El que va grande, arriba. */
  principal: string | null;
  /** El pushname, solo si aporta algo distinto del principal. */
  alias: string | null;
  fuente: FuenteNombre;
}

/**
 * DE DÓNDE SALE EL NOMBRE QUE SE MUESTRA. Va a la vista, chiquito, al lado del
 * alias: decisión del dueño (#118) — «el nombre del formulario manda», pero la
 * ficha tiene que **decir de dónde sale**, porque no es lo mismo un nombre que
 * alguien tipeó en un anuncio que uno que firmó una compra. Sin la procedencia,
 * el panel afirmaría con la misma cara un dato verificado y uno declarado.
 */
export const PROCEDENCIA: Record<FuenteNombre, string | null> = {
  cerberus: 'de Cerberus',
  formulario: 'del formulario',
  whatsapp: null, // el alias YA se muestra como «en WhatsApp: …»: decirlo dos veces sobra
  ninguna: null,
};

const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function util(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length > 0 ? s : null;
}

export function nombreDelContacto(e: {
  pushname?: string | null;
  leadNombre?: string | null;
  cerberusNombre?: string | null;
}): NombreDelContacto {
  const push = util(e.pushname);
  const candidatos: [FuenteNombre, string | null][] = [
    ['cerberus', util(e.cerberusNombre)],
    ['formulario', util(e.leadNombre)],
    ['whatsapp', push],
  ];
  const elegido = candidatos.find(([, v]) => v !== null);
  if (!elegido) return { principal: null, alias: null, fuente: 'ninguna' };

  const [fuente, principal] = elegido;
  const alias = fuente !== 'whatsapp' && push && canon(push) !== canon(principal!) ? push : null;
  return { principal: principal!, alias, fuente };
}
