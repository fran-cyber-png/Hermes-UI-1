import { useState } from 'react';
import {
  BasicTextStyleButton,
  FormattingToolbar,
  FormattingToolbarController,
  NestBlockButton,
  TableCellMergeButton,
  TextAlignButton,
  UnnestBlockButton,
} from '@blocknote/react';
import { BotonDeColores, ProveedorDeColores } from './SelectorDeColores';

/**
 * LA BARRITA FLOTANTE DE FORMATO — negrita, alinear, combinar celdas y
 * colores, al seleccionar texto o celdas. Reemplaza a la Ribbon fija (ver el
 * historial de `Libreta.tsx`): esto es lo que BlockNote ya trae para
 * seleccionar-y-formatear, y no hacía falta una barra propia arriba.
 *
 * ══ EL BUG QUE SE REPORTÓ, Y LA PISTA FALSA QUE PARECÍA AL PRINCIPIO ═══════
 *
 * «Colores» no hacía nada: tocarlo cerraba la barrita entera antes de que el
 * panel llegara a abrirse. Medido primero con el mouse quieto entre
 * `mousedown` y `mouseup`, parecía que CUALQUIER clic afuera del papel
 * colapsaba la selección (hasta un botón del riel sin relación alguna lo
 * disparaba) — una pista real, pero no la causa.
 *
 * 🔴 **LA CAUSA DE VERDAD: EL EDITOR SE REMONTABA ENTERO, SOLO, SIN NINGÚN
 * CLIC.** Medido con el mouse quieto del todo —sin tocar nada— la selección
 * se perdía igual, siempre a los ~400-800 ms de haberla hecho. Ese número es
 * el de `ESPERA_AUTOGUARDADO_MS` (`useAutoguardado.ts`): en una página
 * NUEVA, el primer guardado exitoso dispara `alCrear(id)`, que en
 * `Libreta.tsx` cambia `seleccion` de `{tipo:'nueva'}` a `{tipo:'nota', id,
 * origen:'nota'}` — y esas dos ramas del JSX usan un `key` DISTINTO
 * (`key="nueva"` vs. `key={`${origen}-${id}`}`), a propósito, para que
 * cambiar de nota remonte el editor. El primer guardado de una nota nueva
 * ES, para React, indistinguible de «cambiaste de nota»: mismo remonte,
 * mismo BlockNote nuevo de cero, misma selección perdida — nada de esto tiene
 * que ver con Mantine, con floating-ui ni con ningún botón.
 *
 * ⚠️ **Esto sigue sin arreglarse, y hay que decirlo**: seleccionar texto para
 * formatearlo DURANTE la ventana de ese primer guardado (escribís algo en una
 * página recién creada y en menos de ~1 s ya estás seleccionando) todavía
 * pierde la selección — no hay `preventDefault` ni truco de UI que lo evite,
 * porque el editor entero deja de existir y nace uno nuevo. En una página que
 * YA tiene fila (cualquier edición después del primer guardado, o abrir una
 * nota vieja) el problema no existe: verificado a mano, con el estilo
 * aplicándose de verdad (`data-background-color` en el `<span>`).
 *
 * ══ POR QUÉ EL PANEL DE COLORES SIGUE VIVIENDO AFUERA, IGUAL ═══════════════
 *
 * Aunque la causa resultó ser el remonte y no un cierre del popover del
 * paquete, sacar el panel de adentro de `FormattingToolbarController` sigue
 * siendo lo correcto: esa barrita puede desmontarse por ESTE motivo hoy, y
 * por cualquier otro mañana (`shouldShow()` tiene más de una condición). El
 * panel vive en `BarraFlotante`, que está montada siempre, y el gatillo
 * (`BotonDeColores`, en `SelectorDeColores.tsx`) sólo AVISA cuándo abrir y
 * DÓNDE —su propio rectángulo, tomado en el mismo `onClick`— sin depender de
 * seguir existiendo un instante después.
 *
 * 🔴 **Lo que SE PROBÓ Y NO SIRVIÓ**: pisarle el cierre al store del paquete
 * con un truco «prevent-hide» (el mismo que usa el bubble menu de Tiptap).
 * Cuando la causa es un REMONTE, no un cierre, el store viejo ni siquiera es
 * el mismo objeto después — pisarlo armaba un ping-pong de
 * verdadero/falso contra un store a punto de desaparecer, y Playwright lo
 * delató con «element was detached from the DOM, retrying» en loop.
 *
 * ══ POR QUÉ NO ALCANZA CON ENVOLVER EN JSX ═══════════════════════════════════
 *
 * `FormattingToolbarController` no dibuja donde se lo escribe: se porta a
 * `editor.portalElement` (normalmente `document.body`). Por eso el
 * `portalElement` de esta barrita SE REDIRIGE a un contenedor nuestro.
 *
 * ⚠️ **`setContenedor` y no un `useRef`**: en el primer render el nodo del
 * `<div>` todavía no existe, así que un ref normal daría `null` justo cuando
 * hace falta. Con estado, el callback-ref dispara un re-render en cuanto el
 * nodo existe de verdad.
 */
function ContenidoDeLaBarrita() {
  return (
    <FormattingToolbar>
      <BasicTextStyleButton basicTextStyle="bold" key="negrita" />
      <BasicTextStyleButton basicTextStyle="italic" key="cursiva" />
      <BasicTextStyleButton basicTextStyle="underline" key="subrayado" />
      <BasicTextStyleButton basicTextStyle="strike" key="tachado" />
      <TextAlignButton textAlignment="left" key="izquierda" />
      <TextAlignButton textAlignment="center" key="centro" />
      <TextAlignButton textAlignment="right" key="derecha" />
      <BotonDeColores key="colores" />
      <NestBlockButton key="masSangria" />
      <UnnestBlockButton key="menosSangria" />
      <TableCellMergeButton key="combinarCeldas" />
    </FormattingToolbar>
  );
}

export function BarraFlotante() {
  const [contenedor, setContenedor] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setContenedor} onMouseDown={(e) => e.preventDefault()}>
      <ProveedorDeColores>
        {(panelDeColores) => (
          <>
            {contenedor && (
              <FormattingToolbarController portalElement={contenedor} formattingToolbar={ContenidoDeLaBarrita} />
            )}
            {panelDeColores}
          </>
        )}
      </ProveedorDeColores>
    </div>
  );
}
