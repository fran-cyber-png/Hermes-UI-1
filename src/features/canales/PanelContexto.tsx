import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Search } from 'lucide-react';
import { API_URL } from '../../config';
import { kicker, sectionLabel } from '../../lib/styles';
import type { Conversacion } from './conversaciones';
import { BadgeCanal, nombreCanal } from './BadgeCanal';
import HistorialPersona from './HistorialPersona';
import { RegistrarGestion } from '../gestion/RegistrarGestion';

/**
 * EL PANEL DE CONTEXTO — el lado derecho cuando la conversación es de Meta.
 *
 * Es el hermano del `FichaContacto` (que aplica a WhatsApp, por teléfono): acá va
 * lo que SÍ sabemos de un comentario o un DM — en qué publicación fue, el link
 * para verla, y si la persona ya había escrito antes.
 *
 * Versión 0 con lo que la ingesta ya captura hoy. El contexto completo (texto
 * entero de la publicación, imagen, curso inferido del anuncio) llega con los
 * slices S8 (`docs/plan-panel-contexto.md`) — y este panel lo dice, no lo
 * disimula: cada hueco de datos se declara.
 */

/** Iniciales para el retrato. "@marisol.ttito" → "MA"; "Aldo L" → "AL". */
function iniciales(nombre: string | null): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
  return limpio.slice(0, 2).toUpperCase();
}

export function PanelContexto({ conversacion }: { conversacion: Conversacion }) {
  // Los comentarios llegan con clave `int:<id>` — con ese id se resuelven el
  // permalink y el historial. Las conversaciones de Messenger agrupan varios
  // mensajes y no traen un id único: esas piezas quedan honestas hasta S8.
  const interactionId = conversacion.clave.startsWith('int:')
    ? Number(conversacion.clave.slice(4))
    : null;

  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    setLink(null);
    if (!interactionId) return;
    fetch(`${API_URL}/api/persona/${interactionId}/link`)
      .then((r) => r.json())
      .then((d) => setLink(d.permalink ?? null))
      .catch(() => setLink(null));
  }, [interactionId]);

  const esComentario = conversacion.tipo === 'comentario';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      {/* El avatar-header ES el título del panel — sin cintillo «Contexto». */}
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="relative shrink-0">
            <span className="flex size-9 items-center justify-center rounded-[12px] bg-secondary font-heading text-xs font-bold text-navy">
              {iniciales(conversacion.persona_nombre)}
            </span>
            <span className="absolute -bottom-0.5 -right-0.5">
              <BadgeCanal canal={conversacion.canal} />
            </span>
          </span>
          <div className="min-w-0">
            <div className="truncate font-heading text-sm font-bold text-foreground">
              {conversacion.canal === 'instagram' && conversacion.persona_nombre ? '@' : ''}
              {conversacion.persona_nombre ?? 'Sin nombre'}
            </div>
            <div className="text-xs text-muted-foreground">
              {nombreCanal(conversacion.canal)} · {esComentario ? 'comentario' : 'mensaje directo'}
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {esComentario ? (
          <>
            <div className={kicker}>Comentó en</div>
            {conversacion.contexto_texto ? (
              <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
                  <FileText size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-4 italic">“{conversacion.contexto_texto}”</span>
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Es el comienzo de la publicación, no el texto completo.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                La publicación no se capturó. No es que no exista: todavía no la pedimos.
              </p>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Ver la publicación en {nombreCanal(conversacion.canal)} <ExternalLink size={11} />
              </a>
            )}

            {/* Ya te había escrito: el contact-merge dentro del canal. */}
            {interactionId && <HistorialPersona interactionId={interactionId} />}
          </>
        ) : (
          <>
            <div className={kicker}>De dónde vino</div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Messenger no dice de qué publicación o anuncio vino este chat con la captura actual. El
              origen real llega con el webhook de Messenger; hasta entonces, este espacio queda vacío
              a propósito: preferimos el hueco visible al invento.
            </p>

            <div className={'mt-5 ' + sectionLabel}>Ficha de Cerberus</div>
            <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-2">
                <Search size={13} className="mt-0.5 shrink-0" />
                <span>
                  La ficha se busca por <span className="font-semibold text-foreground">teléfono</span>, y Messenger no lo trae.
                  Si te pasa su número en el chat, buscalo en la vista <span className="font-semibold text-foreground">Contactos</span> y
                  ahí tenés su ficha completa.
                </span>
              </p>
            </div>
          </>
        )}
      </div>

      {/* La bitácora comercial: etapa + próxima acción (cae en la Agenda) + notas. */}
      <RegistrarGestion conversacion={conversacion} />
    </div>
  );
}
