/**
 * LAS CINCO PESTAÑAS — la IDENTIDAD de la Ribbon, y NADA MÁS.
 *
 * ══ 🔴 POR QUÉ ESTO NO PUEDE VOLVER A `catalogo.ts` ═════════════════════════
 *
 * Vivía ahí, y esa cercanía costaba **358 KB gzip en el chunk de entrada de la
 * vista Libreta**. La cadena es de un solo salto y no se ve leyendo ninguno de
 * los dos archivos:
 *
 *     Libreta.tsx      import { TAB_POR_DEFECTO } from './ribbon/catalogo'
 *     catalogo.ts:1    import { ESQUEMA_LIBRETA } from '../editor'
 *     editor.ts:1      import { BlockNoteSchema } from '@blocknote/core'
 *
 * O sea: la cáscara de la vista pedía la cadena `'inicio'` y se llevaba el
 * motor del editor. Medido con `vite build`: entrar a la Libreta pasó de
 * **377,8 KB gzip a 19,7 KB** al cortar este borde (más el `lazy()` de
 * `perezosos.tsx`).
 *
 * El import de `catalogo.ts` **está bien y se queda**: los botones de «Insertar»
 * se DERIVAN del esquema para que el día que los adjuntos existan no queden
 * cuatro cajas apagadas sin que nadie se entere. Lo que estaba mal es el borde
 * del módulo, no la regla: acá va lo que se puede saber sin abrir el editor
 * (cómo se llaman las pestañas y en qué orden van), y allá lo que necesita
 * preguntarle al esquema (qué comandos hay y cuáles andan de verdad).
 *
 * ⚠️ **`catalogo.ts` NO re-exporta esto a propósito.** Un `export { TABS } from
 * './tabs'` sería un puente por el que la cáscara vuelve a entrar al catálogo
 * sin notarlo — y el defecto reaparecería igual de invisible que la primera vez.
 * Quien necesite una pestaña, la pide acá.
 *
 * El candado que ve la recaída es del BUILD, no de un test de módulos:
 * `npm run presupuesto` (ver `scripts/presupuesto-de-chunks.mjs`).
 */
export type TabRibbon = 'inicio' | 'insertar' | 'dibujar' | 'revisar' | 'vista';

export interface Tab {
  id: TabRibbon;
  etiqueta: string;
}

/** Las cinco, siempre en el mismo orden y siempre todas. */
export const TABS: readonly Tab[] = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'insertar', etiqueta: 'Insertar' },
  { id: 'dibujar', etiqueta: 'Dibujar' },
  { id: 'revisar', etiqueta: 'Revisar' },
  { id: 'vista', etiqueta: 'Vista' },
];

export const TAB_POR_DEFECTO: TabRibbon = 'inicio';

export function esTabRibbon(valor: unknown): valor is TabRibbon {
  return TABS.some((t) => t.id === valor);
}
