import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import type { Conversacion } from './conversaciones';
import { HiloWhatsapp } from '../whatsapp/HiloWhatsapp';
import ResponderPanel from './ResponderPanel';
import type { Interaccion } from './types';

/**
 * EL PANEL DE LA DERECHA: la conversación abierta.
 *
 * Es un conmutador según qué se eligió en la cola:
 *   · WhatsApp  → el hilo nativo (`HiloWhatsapp`): ver y responder desde Hermes.
 *   · Comentario FB/IG → el flujo de respuesta pública + privada (`ResponderPanel`).
 *   · Messenger → lectura (responder DMs de Messenger todavía no está conectado).
 *   · Nada      → un vacío que invita a elegir.
 */
export function ConversacionActiva({
  conversacion,
  onCerrar,
}: {
  conversacion: Conversacion | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();

  if (!conversacion) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
        <MessageSquareText size={28} className="mb-3 text-muted-foreground/50" />
        <p className="text-sm font-semibold text-foreground">Elegí a alguien de la cola</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Su conversación aparece acá, con la ficha al lado para saber quién es antes de escribir.
        </p>
      </div>
    );
  }

  // WhatsApp: el hilo nativo. La razón de ser de este panel.
  if (conversacion.canal === 'whatsapp') {
    return <HiloWhatsapp conversacion={conversacion} />;
  }

  // Comentario de Facebook/Instagram: el flujo de respuesta pública + privada, que
  // ya estaba resuelto (privado antes que público). Se reusa tal cual.
  if (conversacion.tipo === 'comentario') {
    const inter: Interaccion = {
      id: Number(conversacion.clave.replace('int:', '')),
      canal: conversacion.canal,
      tipo: 'comentario',
      persona_nombre: conversacion.persona_nombre,
      texto: conversacion.texto,
      contexto_texto: conversacion.contexto_texto,
      occurred_at: conversacion.referencia,
      status: conversacion.respondida ? 'contactado' : 'nuevo',
      pide_info: conversacion.pide_info,
      ventana_abierta: conversacion.ventana_abierta,
      dias: conversacion.dias,
    };
    return (
      <ResponderPanel
        interaccion={inter}
        onCerrar={onCerrar}
        onRespondido={() => void qc.invalidateQueries({ queryKey: ['conversaciones'] })}
      />
    );
  }

  // Messenger (canal Meta, tipo mensaje): lectura honesta.
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-border bg-card p-8 text-center">
      <p className="text-sm font-semibold text-foreground">{conversacion.persona_nombre ?? 'Conversación'}</p>
      <p className="mt-2 max-w-xs text-xs text-muted-foreground">
        Responder DMs de Messenger todavía no está conectado desde Hermes. Por ahora, abrilo en Meta
        Business Suite.
      </p>
    </div>
  );
}
