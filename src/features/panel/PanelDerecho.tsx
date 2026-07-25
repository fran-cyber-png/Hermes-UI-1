import { useState } from 'react';
import { BookOpen, NotebookPen, Send, UserRound, type LucideIcon } from 'lucide-react';
import type { Conversacion } from '../canales/conversaciones';
import { Avatar } from '../canales/Avatar';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import { PanelContexto } from '../canales/PanelContexto';
import { FichaContacto } from '../cerberus/FichaContacto';
import { PanelNotas } from '../notas/PanelNotas';
import { PanelPlantillas } from '../plantillas/PanelPlantillas';
import { DosRespuestas } from '../sugerencias/DosRespuestas';
import { FranjaEtiquetas } from '../senales/FranjaEtiquetas';
import { ponerEnComposer } from '../whatsapp/puenteComposer';
import { PanelCurso } from './PanelCurso';
import { pestanaInicial, pestanasDe, type IdPestana } from './pestanas';

/**
 * EL PANEL DERECHO, MULTIFUNCIÓN.
 *
 * Antes era solo la ficha. Ahora es la mesa de trabajo del lado derecho, con un
 * orden que no es casual — de arriba abajo, en el orden en que la vendedora
 * necesita las cosas:
 *
 *   1. **QUIÉN ES** — avatar, nombre, canal. Siempre visible.
 *   2. **QUÉ ES** — la franja de etiquetas: «Cotizado», «Se enfrió» y las
 *      categorías que ella puso. Siempre visible, con colores, de un vistazo.
 *   3. **QUÉ MANDARLE** — las dos respuestas listas, a un clic. Siempre visible:
 *      es lo que la vendedora aprieta, no algo que tenga que ir a buscar.
 *   4. **EL RESTO**, en pestañas — Ficha · Enviar · Notas · Curso.
 *
 * ══ POR QUÉ PESTAÑAS Y NO ACORDEÓN ═══════════════════════════════════════════
 *
 * El panel mide 360 px. Un acordeón con cuatro secciones obliga a plegar lo de
 * arriba para ver lo de abajo y a scrollear para encontrar lo que se usa
 * siempre. Una barra de pestañas cuesta 30 px fijos y deja TODO el alto restante
 * para una sola cosa a la vez — que es como se trabaja un chat: mirando una
 * cosa. Lo que se usa en cada conversación (quién es, qué es, qué mandarle) está
 * fuera de las pestañas justamente para que nunca haya que elegirlo.
 */

const ICONO: Record<IdPestana, LucideIcon> = {
  ficha: UserRound,
  plantillas: Send,
  notas: NotebookPen,
  curso: BookOpen,
};

export function PanelDerecho({
  conversacion,
  onCorreo,
  onAgendarBienvenida,
}: {
  conversacion: Conversacion;
  onCorreo?: (para: string) => void;
  onAgendarBienvenida?: (telefono: string | null) => void;
}) {
  // La preferencia sobrevive al cambio de conversación: el panel no se
  // desmonta, y reordenarle la cabeza a la vendedora en cada chat sería peor
  // que respetarle la última elección.
  const [preferida, setPreferida] = useState<IdPestana | null>(null);

  const esWa = conversacion.canal === 'whatsapp';
  const pestanas = pestanasDe({ canal: conversacion.canal, conTelefono: Boolean(conversacion.persona_id) });
  const activa = pestanaInicial(pestanas, preferida);
  const telefono = conversacion.persona_id;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* 1 y 2 — quién es y qué es. */}
      <header className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="relative shrink-0">
            <Avatar
              nombre={conversacion.persona_nombre ?? telefono}
              telefono={esWa ? telefono : null}
              conFoto={esWa}
              className="size-9 rounded-[12px] bg-secondary font-heading text-xs font-bold text-navy"
            />
            <span className="absolute -bottom-0.5 -right-0.5">
              <BadgeCanal canal={conversacion.canal} />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-heading text-sm font-bold text-foreground">
              {conversacion.canal === 'instagram' && conversacion.persona_nombre ? '@' : ''}
              {conversacion.persona_nombre ?? telefono ?? 'Contacto'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {nombreCanal(conversacion.canal)}
              {conversacion.tipo === 'comentario' ? ' · comentario' : ''}
            </div>
          </div>
        </div>

        <div className="mt-2 empty:mt-0">
          <FranjaEtiquetas clave={conversacion.clave} />
        </div>
      </header>

      {/* 3 — qué mandarle. Solo WhatsApp: es por donde se manda. */}
      {esWa && (
        <div className="shrink-0 border-b border-border px-3 py-2.5">
          <DosRespuestas conversacion={conversacion} onIrAPlantillas={() => setPreferida('plantillas')} />
        </div>
      )}

      {/* 4 — el resto. */}
      <nav
        role="tablist"
        aria-label="Secciones del panel"
        className="flex shrink-0 gap-0.5 border-b border-border px-1.5"
      >
        {pestanas.map((p) => {
          const Icono = ICONO[p.id];
          const esActiva = p.id === activa;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={esActiva}
              aria-disabled={!p.disponible}
              title={p.motivo}
              onClick={() => p.disponible && setPreferida(p.id)}
              className={
                'relative flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-semibold transition-colors ' +
                (!p.disponible
                  ? 'cursor-default text-muted-foreground/40'
                  : esActiva
                    ? 'text-navy'
                    : 'text-muted-foreground hover:text-foreground')
              }
            >
              <Icono size={12} strokeWidth={esActiva ? 2.4 : 1.8} />
              {p.etiqueta}
              {esActiva && (
                <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-navy" />
              )}
            </button>
          );
        })}
      </nav>

      <div key={activa} className="animate-entrar min-h-0 flex-1 overflow-hidden px-3 py-3">
        {activa === 'ficha' ? (
          esWa ? (
            <FichaContacto
              conversacion={conversacion}
              onCorreo={onCorreo}
              onAgendarBienvenida={onAgendarBienvenida}
              embebida
            />
          ) : (
            <PanelContexto conversacion={conversacion} embebida />
          )
        ) : activa === 'plantillas' ? (
          <PanelPlantillas
            conversacion={conversacion}
            onEditarEnComposer={
              telefono ? (texto) => ponerEnComposer({ telefono, texto }) : undefined
            }
          />
        ) : activa === 'notas' ? (
          <div className="h-full overflow-y-auto">
            <PanelNotas clave={conversacion.clave} siempreAbierto />
          </div>
        ) : (
          <PanelCurso clave={conversacion.clave} />
        )}
      </div>
    </div>
  );
}
