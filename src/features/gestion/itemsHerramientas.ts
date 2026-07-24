import { Mail, MessageSquareQuote, NotebookPen, Package, Tag, type LucideIcon } from 'lucide-react';

/**
 * EL MENÚ DE HERRAMIENTAS — el contenedor, no las herramientas.
 *
 * Las cinco entradas que el equipo decidió (`FLUJO.md`) para el botón `···`
 * de la `BarraGestion`. Cada herramienta real (correo rápido, mensajes
 * predeterminados, etiquetas con color, notas, catálogo) es su propio issue
 * y todavía no aterrizó — por eso `armarItemsMenu` recibe los handlers como
 * un mapa PARCIAL: la herramienta sin handler se pinta deshabilitada con
 * «Próximamente», y el día que exista el issue de esa herramienta alcanza
 * con pasarle su callback acá para que el item cobre vida solo.
 */

export type IdHerramienta = 'correo' | 'mensajes' | 'etiquetas' | 'notas' | 'catalogo';

export interface DefinicionHerramienta {
  id: IdHerramienta;
  etiqueta: string;
  Icono: LucideIcon;
}

/** El orden es el de `FLUJO.md`: no se reordena por gusto. */
export const HERRAMIENTAS: DefinicionHerramienta[] = [
  { id: 'correo', etiqueta: 'Correo rápido', Icono: Mail },
  { id: 'mensajes', etiqueta: 'Mensajes predeterminados', Icono: MessageSquareQuote },
  { id: 'etiquetas', etiqueta: 'Etiquetas', Icono: Tag },
  { id: 'notas', etiqueta: 'Listas / notas', Icono: NotebookPen },
  { id: 'catalogo', etiqueta: 'Catálogo', Icono: Package },
];

export interface ItemMenu extends DefinicionHerramienta {
  /** `null` = todavía no hay herramienta (issue aparte): el item se deshabilita. */
  onSeleccionar: (() => void) | null;
}

/**
 * Ata cada herramienta a la `clave` de la conversación abierta — lo único
 * que el menú «pasa hacia abajo». Pura: sin DOM, testeable con un spy sobre
 * el handler para verificar que le llega la `clave` correcta.
 */
export function armarItemsMenu(
  clave: string,
  handlers: Partial<Record<IdHerramienta, (clave: string) => void>> = {},
): ItemMenu[] {
  return HERRAMIENTAS.map((herramienta) => {
    const handler = handlers[herramienta.id];
    return {
      ...herramienta,
      onSeleccionar: handler ? () => handler(clave) : null,
    };
  });
}
