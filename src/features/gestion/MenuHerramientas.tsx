import { useEffect, useRef, useState } from 'react';
import { MoreVertical, X } from 'lucide-react';
import { usePopover } from '../../lib/teclado/usePopover';
import { armarItemsMenu } from './itemsHerramientas';
import { GestorCategorias } from './GestorCategorias';
import type { Conversacion } from '../../dominio/conversaciones';
import { PanelPlantillas } from '../plantillas/PanelPlantillas';
import { PantallaHechos } from '../hechos/PantallaHechos';

/**
 * EL BOTÓN `···` — la puerta única a las herramientas de venta, siempre en
 * el mismo lugar sobre CUALQUIER conversación.
 *
 * De las cinco herramientas (correo rápido, mensajes predeterminados,
 * etiquetas, notas, catálogo), ya aterrizaron **dos**: «Etiquetas» (#48) abre
 * el `GestorCategorias` y **«Mensajes predeterminados» (#45/#101)** abre el
 * cajón de secuencias. Las que faltan siguen deshabilitadas con «Próximamente»
 * — el día que existan, `MenuHerramientas` le pasa su callback a
 * `armarItemsMenu` y el item se habilita solo.
 *
 * El cierre —Escape y clic afuera, sin chocar con el composer del chat— lo
 * pone `usePopover` (`src/lib/teclado/`). Lo propio de acá: panel `absolute`
 * con `shadow-panel` (sombra, sin borde) y botones planos con
 * `aria-label`/`title`, sin roles de menú — son botones en un panel, no un
 * `<menu>` con navegación por flechas.
 */
export function MenuHerramientas({ conversacion }: { conversacion: Conversacion }) {
  const clave = conversacion.clave;
  const [abierto, setAbierto] = useState(false);
  const [gestorAbierto, setGestorAbierto] = useState(false);
  const [plantillasAbiertas, setPlantillasAbiertas] = useState(false);
  const [datosAbiertos, setDatosAbiertos] = useState(false);
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
  const items = armarItemsMenu(clave, {
    etiquetas: () => setGestorAbierto(true),
    mensajes: () => setPlantillasAbiertas(true),
    // El catálogo de datos recomendados (`hechos`). Vive acá porque el bloque
    // que los mostraba en el panel derecho quedó huérfano al rediseño de ADR
    // 0017 y nadie lo monta: una puerta ahí no se abre desde ningún lado.
    datos: () => setDatosAbiertos(true),
  });

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

      {/* Las secuencias de venta (#45/#101). Panel lateral, no modal: la
          vendedora sigue viendo el chat mientras elige qué mandar. */}
      {plantillasAbiertas && (
        <>
          <span
            className="fixed inset-0 z-40 bg-navy/20"
            onClick={() => setPlantillasAbiertas(false)}
            aria-hidden="true"
          />
          <aside className="fixed right-0 top-0 z-50 flex h-full w-[22rem] max-w-[92vw] flex-col bg-card p-3 shadow-panel">
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <h2 className="font-heading text-sm font-bold text-navy-ink">Mensajes predeterminados</h2>
              <button
                type="button"
                onClick={() => setPlantillasAbiertas(false)}
                aria-label="Cerrar"
                className="ml-auto rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <PanelPlantillas conversacion={conversacion} />
            </div>
          </aside>
        </>
      )}

      {/* El catálogo de datos recomendados: pantalla completa, porque lo que
          hay que poder mirar —qué llega a verse en cada momento— no entra en un
          cajón de 22rem. Cierra con Escape (contrato de `useEscape`). */}
      {datosAbiertos && <PantallaHechos onCerrar={() => setDatosAbiertos(false)} />}
    </span>
  );
}
