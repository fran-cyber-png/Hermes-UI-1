import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { useEstadoConversacion, type Conversacion } from '../../dominio/conversaciones';
import { HiloWhatsapp, type SugerenciaEnComposer } from '../whatsapp/HiloWhatsapp';
import { HiloMessenger } from './HiloMessenger';
import ResponderPanel from './ResponderPanel';
import { BarraGestion } from '../gestion/BarraGestion';
import type { Interaccion } from './types';

/**
 * LA COLUMNA CENTRAL: la conversación abierta.
 *
 * Es un conmutador según qué se eligió en la cola:
 *   · WhatsApp  → el hilo nativo (`HiloWhatsapp`): ver y responder desde Hermes.
 *   · Comentario FB/IG → el flujo de respuesta pública + privada (`ResponderPanel`,
 *     que vive EN esta columna — dejó de ser un modal que tapaba la mesa).
 *   · Messenger → el hilo completo en lectura (`HiloMessenger`), con la caja
 *     deshabilitada honesta.
 *   · Nada      → un vacío que invita a elegir.
 */
export function ConversacionActiva({
  conversacion,
  onCerrar,
  sugerencia,
  miVendedora,
}: {
  conversacion: Conversacion | null;
  onCerrar: () => void;
  /**
   * Quién está mirando. Baja hasta la `BarraGestion` para el reparto: sin esto,
   * «pasar la conversación» no puede decir «Vos» ni marcar cuál de los destinos
   * es quien está operando. Viaja como prop y no llamando a `useSesion()` acá
   * abajo a propósito — ese hook pide `/api/auth/yo` al montar, así que una
   * segunda llamada sería un request más por cada conversación que se abre.
   */
  miVendedora?: string | null;
  /**
   * MODO REVISIÓN (ADR 0018): la auto-respuesta que Hermes preparó para ESTA
   * conversación, para que el composer la muestre como borrador aprobable.
   * Viaja como prop y no por contexto a propósito — así se lee, en el shell,
   * quién decide que hay algo que revisar.
   */
  sugerencia?: SugerenciaEnComposer;
}) {
  const qc = useQueryClient();

  // Avanzar el cursor de lectura al abrir el hilo, CROSS-CANAL (#49): marca la
  // conversación como leída (el punto azul se apaga) para todos los canales, no
  // solo WhatsApp. Los ticks azules de WhatsApp son un efecto lateral aparte
  // (`useConversacionWa.marcarLeido`). Es una escritura por acción humana: abrir.
  const estado = useEstadoConversacion();
  const clave = conversacion?.clave ?? null;
  useEffect(() => {
    if (!clave) return;
    estado.mutate({ clave, leido: true });
    // Solo al cambiar de conversación: `estado` es estable entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

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

  // El embudo entero, manejable desde el chat: etapa, etiquetas, intereses,
  // agendar — arriba de CUALQUIER conversación, sin soltar el hilo.
  const conBarra = (contenido: React.ReactNode) => (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <BarraGestion conversacion={conversacion} miVendedora={miVendedora} />
      <div className="min-h-0 flex-1">{contenido}</div>
    </div>
  );

  // WhatsApp: el hilo nativo. La razón de ser de este panel.
  if (conversacion.canal === 'whatsapp') {
    return conBarra(<HiloWhatsapp conversacion={conversacion} sugerencia={sugerencia} />);
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
      pide_info: conversacion.pregunto,
      ventana_abierta: conversacion.ventana_abierta,
      dias: conversacion.dias,
    };
    return conBarra(
      <ResponderPanel
        interaccion={inter}
        onCerrar={onCerrar}
        onRespondido={() => void qc.invalidateQueries({ queryKey: ['conversaciones'] })}
      />,
    );
  }

  // Messenger (canal Meta, tipo mensaje): el hilo completo, en lectura.
  return conBarra(<HiloMessenger conversacion={conversacion} />);
}
