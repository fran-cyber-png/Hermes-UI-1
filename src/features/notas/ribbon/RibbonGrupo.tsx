import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

/**
 * UN GRUPO DE LA RIBBON — controles arriba, rótulo abajo, línea al costado.
 *
 * ══ EL RÓTULO NO SE ESCONDE NUNCA, Y ES LO ÚNICO QUE NO SE ESCONDE ══════════
 *
 * Cuando falta espacio se achica el aire, después se van los rótulos de los
 * BOTONES, y por último el grupo entero cae al desplegable «Más». El rótulo del
 * GRUPO se queda mientras el grupo se vea, porque es la mitad del argumento de
 * este frente: la barra de antes tenía los mismos íconos y no decía «Párrafo»
 * en ningún lado, así que había que probarlos para saber qué eran.
 *
 * ⚠️ El rótulo va con `mt-auto` y no con `justify-between`: los grupos tienen
 * una o dos filas de controles, y con `justify-between` el de una fila estira su
 * hueco hasta el doble y los rótulos de la barra quedan a distinta altura.
 */
export function RibbonGrupo({
  id,
  etiqueta,
  children,
  compacto,
}: {
  /** La identidad, para que el acomodo pueda medirlo y nombrarlo. */
  id: string;
  etiqueta: string;
  children: ReactNode;
  compacto?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      data-ribbon-grupo={etiqueta}
      data-ribbon-grupo-id={id}
      className={cn(
        'flex shrink-0 flex-col border-r border-border/70 last:border-r-0',
        compacto ? 'gap-0.5 px-1.5' : 'gap-1 px-2.5',
      )}
    >
      <div className={cn('flex flex-col', compacto ? 'gap-0.5' : 'gap-1')}>{children}</div>
      <span className="mt-auto select-none pt-0.5 text-center text-[0.625rem] leading-none text-muted-foreground">
        {etiqueta}
      </span>
    </div>
  );
}

/**
 * Una fila de controles adentro de un grupo. Word apila dos: arriba lo que se
 * elige (fuente, tamaño) y abajo lo que se prende y se apaga (N K S̲). Con una
 * sola fila el grupo «Fuente» mide once cajas de ancho y empuja todo lo demás
 * fuera de la pantalla.
 */
export function RibbonFila({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-0.5', className)}>{children}</div>;
}

/**
 * EL RENGLÓN QUE EXPLICA UNA PESTAÑA ENTERA APAGADA.
 *
 * Va **al final de la fila y una sola vez**, no adentro de cada grupo: si
 * colgara del grupo, «Herramientas» mediría 16 rem de ancho por un texto que
 * habla de los tres. Cada caja igual tiene su motivo en el tooltip; esto ahorra
 * pasar el mouse siete veces para entender que lo que falta es el lienzo.
 */
export function RibbonAviso({ texto }: { texto: string }) {
  return (
    <p className="max-w-[14rem] shrink self-center px-3 text-[0.6875rem] leading-tight text-muted-foreground">
      {texto}
    </p>
  );
}
