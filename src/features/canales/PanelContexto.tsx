import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Search } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { kicker, sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../../dominio/conversaciones';
import type { DestinoCorreo } from '../../lib/puente';
import { BadgeCanal, nombreCanal } from '../../components/BadgeCanal';
import HistorialPersona from './HistorialPersona';
import { Avatar } from '../../components/Avatar';
import { RegistrarGestion } from '../gestion/RegistrarGestion';
import { Intereses } from '../gestion/Intereses';
import { PanelNotas } from '../notas/PanelNotas';
import { BloqueLeadForm } from '../cerberus/BloqueLeadForm';
import { personaEsTelefono, telefonoDe } from '../../dominio/canal';
import { PersonaUnificada } from '../identidad/PersonaUnificada';

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
 *
 * 🔴 **HOY NO LO MONTA NADIE — medido el 17-ago-2026: `grep -rn 'PanelContexto'
 * src/` devuelve su propia definición y cuatro comentarios, y ni un `import`.**
 * O sea que es el MISMO defecto que este archivo cablea acá abajo, una capa más
 * arriba: la pieza existe, se ve bien leída, y no está en la pantalla de nadie.
 * Se deja cableado igual para que el día que se lo vuelva a colgar no nazca sin
 * el puente — pero **antes de tocarlo, verificá si se reconecta o se archiva**;
 * arreglarle detalles a un componente huérfano es trabajo que no llega a la
 * vendedora. Es el mismo caso que la pestaña «Notas» (ver `PanelDerecho.tsx`).
 */

export function PanelContexto({
  conversacion,
  onCorreo,
  embebida = false,
}: {
  conversacion: Conversacion;
  /**
   * 🔴 **UNA PROP OPCIONAL QUE ESCONDE LA FEATURE CUANDO FALTA SE ROMPE SIN UN
   * SOLO SÍNTOMA**, y es la TERCERA vez que muerde alrededor de este mismo
   * bloque. No hay error, no hay log, no hay test rojo: `BloqueLeadForm` dibuja
   * «Escribirle» sólo si le llega `onCorreo`, así que el llamador que se olvida
   * del cable **borra la acción y deja la pantalla perfecta**. Ya pasó con
   * `FichaContacto` —`grep 'onCorreo=' src/` daba cero durante casi un mes— y
   * antes con la pestaña «Notas», declarada y sin nadie que la renderizara.
   *
   * El candado no es acordarse: es `panel/puenteCorreo.test.ts`, que lee el
   * árbol y exige que **todo** montaje de un componente que acepta el puente se
   * lo pase. Una lista de sitios escrita a mano ya quedó corta una vez — fue
   * justo este montaje el que se salteó.
   */
  onCorreo?: (destino: DestinoCorreo) => void;
  /**
   * Dentro del panel multifunción: el marco, el encabezado con la persona y las
   * notas los pone el panel (las notas tienen pestaña propia). `false` = como
   * siempre.
   */
  embebida?: boolean;
}) {
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
    // Por `api()`: la ruta está detrás del perímetro y necesita el Bearer.
    api<{ permalink?: string | null }>(`/api/persona/${interactionId}/link`)
      .then((d) => setLink(d.permalink ?? null))
      .catch(() => setLink(null));
  }, [interactionId]);

  const esComentario = conversacion.tipo === 'comentario';

  return (
    <div
      className={
        embebida
          ? 'flex h-full min-h-0 flex-col'
          : 'flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel'
      }
    >
      {/* El avatar-header ES el título del panel — sin cintillo «Contexto». */}
      <header className={embebida ? 'hidden' : 'shrink-0 border-b border-border px-4 py-3'}>
        <div className="flex items-center gap-2.5">
          <span className="relative shrink-0">
            <Avatar
              nombre={conversacion.persona_nombre}
              telefono={conversacion.canal === 'whatsapp' ? conversacion.persona_id : null}
              numeroPropio={conversacion.numero_propio}
              conFoto={conversacion.canal === 'whatsapp'}
              className="size-9 rounded-[12px] bg-secondary font-heading text-xs font-bold text-navy"
            />
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

      <div className={embebida ? 'min-h-0 flex-1 overflow-y-auto' : 'min-h-0 flex-1 overflow-y-auto px-4 py-4'}>
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

        {/* El lead-form por teléfono (#113): nombre real, CORREO y campaña. En los
            canales de Meta el número no viene, así que esto se auto-oculta; queda
            cableado para cuando la unificación cross-canal (#58) aporte el
            teléfono de un DM/comentario.
            ⚠️ La condición es «¿hay teléfono?» y no «¿es WhatsApp?»: un lead de
            landing trae el suyo, y con la pregunta vieja su correo —el insumo
            para cotizarle— no se mostraba nunca (`canales/canal.ts`). */}
        <BloqueLeadForm
          telefono={telefonoDe(conversacion)}
          activo={personaEsTelefono(conversacion.canal)}
          pushname={conversacion.persona_nombre}
          // La `clave` la pone ACÁ el que la tiene (H7): `BloqueLeadForm` sólo
          // conoce el correo y el nombre del formulario, así que un correo
          // mandado desde este panel saldría con `clave` NULL — que es
          // exactamente lo que tienen las 3 filas de `correos` en producción, y
          // el motivo por el que ninguna aparece en el timeline ni en la
          // medición (`lib/puente.ts`). El `??` respeta lo que ya viniera
          // resuelto en vez de pisarlo.
          onCorreo={
            onCorreo
              ? (destino) => onCorreo({ ...destino, clave: destino.clave ?? conversacion.clave })
              : undefined
          }
        />

        {/* «Le interesa» ya NO va acá cuando esto vive dentro del panel: allá
            está fuera de las pestañas (`panel/BloqueInteres`), porque es lo que
            decide una venta y no puede depender de qué pestaña quedó abierta.
            Suelto sigue mostrándose, que es lo que este componente hacía. */}
        {!embebida && (
          <>
            <div className={'mt-5 ' + sectionLabel}>Le interesa</div>
            <div className="mt-2">
              <Intereses clave={conversacion.clave} compacto />
            </div>
          </>
        )}

        {/* «Es la misma persona que…» (#58) — acá es donde más falta hace: un DM de
            Instagram no trae teléfono, y unirlo al WhatsApp de la misma persona es la
            única forma de que esta ficha muestre su ficha de Cerberus. */}
        <PersonaUnificada
          clave={conversacion.clave}
          nombreActual={conversacion.persona_nombre ?? 'este contacto'}
        />
      </div>

      {/* La bitácora comercial y las notas: en el panel las pone el panel
          (`AccionesContacto` y la pestaña Notas). Acá quedan para el uso suelto. */}
      {!embebida && <RegistrarGestion conversacion={conversacion} />}
      {!embebida && <PanelNotas clave={conversacion.clave} />}
    </div>
  );
}
