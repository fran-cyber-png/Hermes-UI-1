import { Ribbon, type VistaDeLaLibreta } from './ribbon/Ribbon';
import type { TabRibbon } from './ribbon/tabs';

/**
 * LA BARRA DE FORMATO DE LA LIBRETA — hoy es una Ribbon.
 *
 * ══ QUÉ QUEDÓ DE ESTE ARCHIVO, Y POR QUÉ QUEDÓ ══════════════════════════════
 *
 * Todo lo que tenía se mudó a `ribbon/`. Este archivo sigue existiendo porque es
 * **el nombre por el que `Libreta.tsx` la monta y por el que los tests la
 * buscan**, y porque conviene que haya un solo lugar donde leer las dos cosas
 * que no cambiaron y siguen siendo las que muerden:
 *
 * 🔴 **`data-libreta-barra` no se renombra.** De ese atributo cuelgan dos cosas
 * que no se ven en ningún test: el `order: -1` de `index.css` —sin el cual la
 * barra queda **60 vh más abajo**, porque BlockNote renderiza sus hijos DESPUÉS
 * del contenido— y la neutralización de `.bn-toolbar`. Lo encontró una captura
 * de pantalla, no un test: jsdom no hace layout.
 *
 * 🔴 **No se dibuja en solo lectura**, y la guarda vive en `Libreta.tsx`. Es el
 * caso del link con permiso `ver` (ADR 0048) y el de una nota histórica de
 * `gestiones`: ofrecer negrita sobre algo que no se puede editar promete una
 * acción que no existe.
 *
 * ⚠️ **Y `formattingToolbar={false}` sigue siendo obligatorio** en
 * `BlockNoteView`. Apaga la barra FLOTANTE de BlockNote; con las dos prendidas,
 * seleccionar texto abre una segunda barra con los mismos botones encima de la
 * fija. Está verificado por mutación que **sacarlo deja los tests en verde**: la
 * flotante se monta en otro portal y sólo con una selección de texto real, que
 * jsdom no produce. Esa mitad la sostiene este comentario y nada más.
 *
 * ══ QUÉ CAMBIÓ DE FONDO ════════════════════════════════════════════════════
 *
 * La barra anterior resolvió que los comandos se vieran. Lo que dejó fue una
 * fila de dieciocho íconos sin un rótulo, que sigue pidiendo probarlos de a uno.
 * La Ribbon los **nombra y los agrupa**, y sobre todo abre lugar declarado para
 * lo que todavía no existe — apagado y con su motivo, nunca fingido. El detalle
 * está en `ribbon/Ribbon.tsx` y la lista de qué es real, en `ribbon/catalogo.ts`.
 */
export function BarraDeFormato({
  tab,
  onTab,
  vista,
}: {
  tab: TabRibbon;
  onTab: (tab: TabRibbon) => void;
  vista: VistaDeLaLibreta;
}) {
  return <Ribbon tab={tab} onTab={onTab} vista={vista} />;
}
