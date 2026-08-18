import { formatKeyboardShortcut } from '@blocknote/core';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import type { Comando } from './catalogo';
import { ICONOS, type NombreDeIcono } from './iconos';

/**
 * EL BOTÓN DE LA RIBBON — y las dos formas que tiene.
 *
 * `grande` es icono arriba y rótulo abajo (las pocas acciones que se buscan sin
 * leer: Pegar, Tabla, Modo lectura). El resto es una caja chica de sólo ícono,
 * con el rótulo en el tooltip. **La proporción importa**: si todo fuera grande
 * no entra nada, y si todo fuera chico volvemos a la fila de íconos indistintos
 * que este frente vino a reemplazar.
 *
 * ══ 🔴 UN BOTÓN APAGADO SIEMPRE DICE POR QUÉ ════════════════════════════════
 *
 * `motivo` va al `title` y **el `title` es lo único que explica un gris**. Una
 * Ribbon tiene lugar para muchas cajas y la mayoría de las de Word acá no
 * existen; una caja gris sin explicación se lee como «está roto», que es peor
 * que la ausencia. El tipo de `catalogo.ts` hace que el motivo no pueda faltar.
 *
 * ⚠️ El tooltip es el `title` del navegador a propósito, y no un popover
 * propio: es lo único que aparece igual con el mouse y con el foco de teclado
 * sin que haya que cablear nada, y la Ribbon tiene ~40 cajas. Lo que un `title`
 * no puede hacer —dibujar el atajo en otra tipografía— no vale ese costo.
 */

export type ModoRibbon = 'completo' | 'compacto';

/** El texto del tooltip: rótulo, atajo y —si está apagado— el porqué. */
function tooltipDe({
  etiqueta,
  atajo,
  motivo,
}: {
  etiqueta: string;
  atajo?: string;
  motivo?: string;
}): string {
  // El mismo formateo que usan los tooltips del paquete, para que un atajo no se
  // lea «Mod+B» en un botón nuestro y «⌘B» en el de al lado.
  const conAtajo = atajo ? `${etiqueta} (${formatKeyboardShortcut(atajo)})` : etiqueta;
  return motivo ? `${conAtajo} — ${motivo}` : conAtajo;
}

export function RibbonBoton({
  icono,
  etiqueta,
  atajo,
  motivo,
  activo,
  deshabilitado,
  grande,
  modo = 'completo',
  onClick,
  extra,
  ...datos
}: {
  icono: NombreDeIcono;
  etiqueta: string;
  atajo?: string;
  motivo?: string;
  /** Un toggle encendido. Se publica como `aria-pressed`, no sólo como color. */
  activo?: boolean;
  deshabilitado?: boolean;
  grande?: boolean;
  modo?: ModoRibbon;
  onClick?: () => void;
  /** Lo que cuelga al lado del ícono (el chevron de un split button). */
  extra?: ReactNode;
  'data-comando'?: string;
  'data-sin-cablear'?: boolean;
}) {
  const Icono = ICONOS[icono];
  const tooltip = tooltipDe({ etiqueta, atajo, motivo });
  // En compacto el rótulo desaparece de la pantalla pero NO del árbol de
  // accesibilidad: el `aria-label` lo lleva siempre.
  const conRotulo = grande && modo === 'completo';

  return (
    <button
      type="button"
      title={tooltip}
      aria-label={etiqueta}
      aria-pressed={activo}
      disabled={deshabilitado}
      // 🔴 `onMouseDown` y no sólo `onClick`: sin el `preventDefault`, apretar
      // el botón **le saca el foco al papel y con él la selección**, y comandos
      // como Cortar, Copiar o el paso de tamaño actúan sobre la nada. Es la
      // misma razón por la que `SelectorBuscable` elige sus opciones con
      // `onMouseDown` — el clic llega después del blur, y para entonces ya es
      // tarde. Los botones del paquete hacen lo suyo llamando a `editor.focus()`.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      data-ribbon-control
      {...datos}
      className={cn(
        'flex shrink-0 items-center justify-center rounded text-foreground transition',
        'hover:bg-secondary disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent',
        activo && 'bg-secondary text-primary',
        // ⚠️ **30 px NO es un número lindo: es el de los botones del paquete.**
        // `Components.FormattingToolbar.Button` monta un `ActionIcon` de Mantine
        // con `size={30}`, y en una fila donde los nuestros y los suyos se
        // alternan (Negrita al lado de Limpiar) dos alturas distintas se ven
        // como un renglón desprolijo. Si el paquete lo cambia, esto se cambia.
        conRotulo ? 'h-14 w-16 flex-col gap-1 px-1 text-[0.625rem] leading-tight' : 'size-[1.875rem]',
      )}
    >
      <Icono className={conRotulo || grande ? 'size-[1.125rem]' : 'size-4'} aria-hidden />
      {conRotulo && <span className="w-full truncate text-center">{etiqueta}</span>}
      {extra}
    </button>
  );
}

/**
 * EL PUENTE ENTRE EL CATÁLOGO Y LA PANTALLA — y el candado de «no fingir».
 *
 * Recibe el `Comando` del catálogo y decide solo:
 *
 *  · `futuro` → **apagado, con su motivo**. No hay una rama en la que un comando
 *    futuro se dibuje encendido: ni siquiera se le pasa el `onClick`.
 *  · `real` sin handler → apagado también, marcado con `data-sin-cablear`. Es el
 *    estado intermedio mientras se cablea una fase, y `Ribbon.test.tsx` falla si
 *    queda alguno: así una caja a medio hacer no puede llegar a producción
 *    pareciendo que anda.
 */
export function RibbonComando({
  comando,
  onClick,
  activo,
  modo,
  bloqueado,
}: {
  comando: Comando;
  onClick?: () => void;
  activo?: boolean;
  modo?: ModoRibbon;
  /**
   * Un motivo por el que AHORA MISMO no se puede, aunque el comando exista: hoy
   * es el modo lectura. Le gana a todo salvo a `futuro`, que es una verdad más
   * permanente y por eso se dice primero.
   */
  bloqueado?: string;
}) {
  const futuro = comando.estado.tipo === 'futuro' ? comando.estado.motivo : undefined;
  const sinCablear = !futuro && !bloqueado && !onClick;

  return (
    <RibbonBoton
      icono={comando.icono}
      etiqueta={comando.etiqueta}
      atajo={comando.atajo}
      motivo={futuro ?? bloqueado ?? (sinCablear ? 'Todavía no cableado' : undefined)}
      grande={comando.destacado}
      modo={modo}
      activo={futuro || bloqueado ? undefined : activo}
      deshabilitado={Boolean(futuro) || Boolean(bloqueado) || sinCablear}
      onClick={futuro || bloqueado ? undefined : onClick}
      data-comando={comando.id}
      data-sin-cablear={sinCablear || undefined}
    />
  );
}
