import { RibbonBoton } from './RibbonBoton';
import { RibbonGrupo } from './RibbonGrupo';

/**
 * EL «MÁS» — a dónde van los grupos que no entran.
 *
 * ══ POR QUÉ UN BOTÓN ROTULADO Y NO SCROLL HORIZONTAL ═══════════════════════
 *
 * Una barra que scrollea de costado **esconde sin decirlo**: no se ve cuántos
 * grupos quedaron a la derecha ni cómo se llaman, y quien no los encuentra
 * concluye que no existen — que es exactamente el problema que esta Ribbon vino
 * a resolver. El botón lleva su número: «Más herramientas (2)».
 *
 * ══ 🔴 Y POR QUÉ ES UNA SEGUNDA FILA Y NO UN PANEL FLOTANTE ════════════════
 *
 * Se intentó primero con `usePopover`, que es la puerta de la casa, y **se
 * recorta**: la fila de comandos necesita `overflow-x` para el caso extremo (el
 * ancho donde ni los grupos primarios entran), y `overflow-x: auto` obliga al
 * navegador a calcular `overflow-y: auto` también. O sea que cualquier panel
 * absoluto que cuelgue de adentro queda cortado por abajo.
 *
 * Las salidas eran dos: un portal con posicionamiento a mano, o abrir hacia
 * abajo dentro del flujo. La segunda es menos código, no se puede recortar, y es
 * lo que Office hace en ventanas angostas.
 *
 * ⚠️ **Por eso NO usa `usePopover` y no es una inconsistencia**: ese hook
 * resuelve «Escape + clic afuera» de una CAPA que tapa lo de atrás. Esto no tapa
 * nada — es un `disclosure`, y por eso lleva `aria-expanded` y se cierra con el
 * mismo botón que lo abrió.
 */
export function RibbonOverflow({
  cuantos,
  abierto,
  onAlternar,
  idPanel,
  compacto,
}: {
  cuantos: number;
  abierto: boolean;
  onAlternar: () => void;
  idPanel: string;
  compacto?: boolean;
}) {
  return (
    <RibbonGrupo id="mas" etiqueta="Más" compacto={compacto}>
      <div className="flex items-center">
        <RibbonBoton
          icono="mas"
          etiqueta={`Más herramientas (${cuantos})`}
          activo={abierto}
          onClick={onAlternar}
          data-comando="mas"
          aria-expanded={abierto}
          aria-controls={idPanel}
        />
      </div>
    </RibbonGrupo>
  );
}
