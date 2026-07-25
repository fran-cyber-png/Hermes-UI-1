import { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';
import { armarItemsMenu } from './itemsHerramientas';
import { GestorCategorias } from './GestorCategorias';

/**
 * EL BOTÓN `···` — la puerta única a las herramientas de venta, siempre en
 * el mismo lugar sobre CUALQUIER conversación.
 *
 * De las cinco herramientas (correo rápido, mensajes predeterminados,
 * etiquetas, notas, catálogo), **«Etiquetas» ya aterrizó** (#48): abre el
 * `GestorCategorias`. Las que faltan siguen deshabilitadas con «Próximamente»
 * — el día que existan, `MenuHerramientas` le pasa su callback a
 * `armarItemsMenu` y el item se habilita solo.
 *
 * El cierre —Escape y clic afuera, sin chocar con el composer del chat— lo
 * pone `usePopover` (`src/lib/teclado/`). Lo propio de acá: panel `absolute`
 * con `shadow-panel` (sombra, sin borde) y botones planos con
 * `aria-label`/`title`, sin roles de menú — son botones en un panel, no un
 * `<menu>` con navegación por flechas.
 */
export function MenuHerramientas({ clave }: { clave: string }) {
  const [abierto, setAbierto] = useState(false);
  const [gestorAbierto, setGestorAbierto] = useState(false);
  const primerItemRef = useRef<HTMLButtonElement>(null);

  // Cambió la conversación (otro lead, otra vista): el menú no puede
  // sobrevivir abierto apuntando a la de antes — `BarraGestion` no se
  // re-keyea por `clave`, así que hay que cerrarlo a mano acá.
  useEffect(() => {
    setAbierto(false);
  }, [clave]);

  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-20' });

  // Al abrir, el foco va al primer item (regla del issue). Los items
  // deshabilitados usan aria-disabled en vez de `disabled` para seguir
  // siendo enfocables — un botón HTML `disabled` no puede recibir foco.
  useEffect(() => {
    if (abierto) primerItemRef.current?.focus();
  }, [abierto]);

  // «Etiquetas» ya tiene herramienta: abre el gestor de categorías (#48). El
  // resto sigue sin handler (deshabilitado) hasta que su propio issue lo conecte.
  const items = armarItemsMenu(clave, { etiquetas: () => setGestorAbierto(true) });

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Más herramientas"
        title="Más herramientas"
        onClick={() => setAbierto((v) => !v)}
        className={
          'flex items-center rounded-full p-1 transition-colors ' +
          (abierto ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')
        }
      >
        <MoreVertical size={15} />
      </button>

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div className="absolute right-0 top-7 z-30 w-56 rounded-xl bg-card p-1.5 shadow-panel">
            {items.map((item, i) => (
              <button
                key={item.id}
                ref={i === 0 ? primerItemRef : undefined}
                type="button"
                aria-disabled={!item.onSeleccionar}
                title={item.onSeleccionar ? undefined : 'Próximamente'}
                onClick={() => {
                  if (!item.onSeleccionar) return;
                  item.onSeleccionar();
                  setAbierto(false);
                }}
                className={
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium transition-colors ' +
                  (item.onSeleccionar
                    ? 'text-foreground hover:bg-muted/50'
                    : 'cursor-default text-muted-foreground/60')
                }
              >
                <item.Icono size={13} className="shrink-0 text-muted-foreground" />
                {item.etiqueta}
              </button>
            ))}
          </div>
        </>
      )}

      {gestorAbierto && <GestorCategorias onCerrar={() => setGestorAbierto(false)} />}
    </span>
  );
}
